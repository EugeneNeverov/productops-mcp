import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Local SQLite store for the response cache and the audit log (spec §6.4, §7.4; ADR 0003).
 * Uses the built-in `node:sqlite` (Node ≥ 22.13). On older Node it is unavailable and the server
 * runs without cache and audit, with a warning in the log.
 */
export interface Store {
  readonly kind: 'sqlite' | 'none';
  cacheGet(key: string, now: number): { value: unknown; fetchedAt: number } | undefined;
  cacheSet(key: string, value: unknown, ttlS: number, now: number): void;
  cacheClear(): number;
  audit(rec: AuditRecord): void;
  auditRows(): AuditRecord[];
  close(): void;
}

export interface AuditRecord {
  ts: string;
  tool: string;
  inputHash: string;
  outcome: string;
  durationMs: number;
  upstreamCalls: number;
}

export const NO_STORE: Store = {
  kind: 'none',
  cacheGet: () => undefined,
  cacheSet: () => {},
  cacheClear: () => 0,
  audit: () => {},
  auditRows: () => [],
  close: () => {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- node:sqlite is loaded dynamically
type Db = any;

export async function openStore(path: string, opts: { retentionDays: number; now?: number }): Promise<Store> {
  let DatabaseSync: new (p: string) => Db;
  try {
    ({ DatabaseSync } = (await import('node:sqlite')) as { DatabaseSync: new (p: string) => Db });
  } catch {
    return NO_STORE;
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db: Db = new DatabaseSync(path);
  if (path !== ':memory:') {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows: the file sits in the user's profile.
    }
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value_json_gz BLOB NOT NULL, fetched_at INTEGER NOT NULL, ttl_s INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (ts TEXT NOT NULL, tool TEXT NOT NULL, input_hash TEXT NOT NULL, outcome TEXT NOT NULL, duration_ms INTEGER NOT NULL, upstream_calls INTEGER NOT NULL);
  `);
  const now = opts.now ?? Date.now();
  db.prepare('DELETE FROM audit_log WHERE ts < ?').run(
    new Date(now - opts.retentionDays * 86_400_000).toISOString(),
  );
  db.prepare('DELETE FROM cache WHERE fetched_at + ttl_s * 1000 < ?').run(now);

  const get = db.prepare('SELECT value_json_gz, fetched_at, ttl_s FROM cache WHERE key = ?');
  const put = db.prepare(
    'INSERT INTO cache (key, value_json_gz, fetched_at, ttl_s) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json_gz = excluded.value_json_gz, fetched_at = excluded.fetched_at, ttl_s = excluded.ttl_s',
  );
  const log = db.prepare(
    'INSERT INTO audit_log (ts, tool, input_hash, outcome, duration_ms, upstream_calls) VALUES (?, ?, ?, ?, ?, ?)',
  );
  return {
    kind: 'sqlite',
    cacheGet(key, at) {
      const row = get.get(key) as
        { value_json_gz: Uint8Array; fetched_at: number; ttl_s: number } | undefined;
      if (!row || row.fetched_at + row.ttl_s * 1000 < at) return undefined;
      return { value: JSON.parse(gunzipSync(row.value_json_gz).toString('utf8')), fetchedAt: row.fetched_at };
    },
    cacheSet(key, value, ttlS, at) {
      put.run(key, gzipSync(JSON.stringify(value)), at, ttlS);
    },
    cacheClear() {
      return Number(db.prepare('DELETE FROM cache').run().changes);
    },
    audit(r) {
      log.run(r.ts, r.tool, r.inputHash, r.outcome, Math.round(r.durationMs), r.upstreamCalls);
    },
    auditRows() {
      return (db.prepare('SELECT * FROM audit_log ORDER BY ts').all() as Record<string, unknown>[]).map(
        (r) => ({
          ts: String(r.ts),
          tool: String(r.tool),
          inputHash: String(r.input_hash),
          outcome: String(r.outcome),
          durationMs: Number(r.duration_ms),
          upstreamCalls: Number(r.upstream_calls),
        }),
      );
    },
    close() {
      db.close();
    },
  };
}

export function cacheKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function auditCsv(rows: AuditRecord[]): string {
  const head = 'ts,tool,input_hash,outcome,duration_ms,upstream_calls';
  return (
    [
      head,
      ...rows.map((r) => [r.ts, r.tool, r.inputHash, r.outcome, r.durationMs, r.upstreamCalls].join(',')),
    ].join('\n') + '\n'
  );
}
