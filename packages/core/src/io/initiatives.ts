import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { ToolFailure } from '../schemas/errors.js';
import type { Warning } from '../schemas/meta.js';
import { Initiative, MAX_INITIATIVES, type InitiativesSource } from '../scoring/model.js';

export const MAX_FILE_BYTES = 1024 * 1024;

export interface LoadContext {
  /** Absolute, already-resolved directories files may be read from. */
  allowedRoots: string[];
  /** Absolute paths of bundled demo datasets by name. */
  demoFiles?: Record<string, string>;
  warn(w: Warning): void;
}

const LIST_FIELDS = new Set(['tags', 'dependsOn']);
const NUMBER_FIELDS = new Set([
  'reach',
  'impact',
  'confidence',
  'effort',
  'businessValue',
  'timeCriticality',
  'riskReductionOpportunity',
  'jobSize',
]);
const BOOLEAN_FIELDS = new Set(['mandatory']);
const KNOWN_FIELDS = new Set(Object.keys(Initiative.shape));

/** Loads and validates initiatives from any source. Throws ToolFailure on bad input. */
export function loadInitiatives(source: InitiativesSource, ctx: LoadContext): Initiative[] {
  let items: Initiative[];
  if (source.kind === 'inline') {
    items = source.items;
  } else if (source.kind === 'demo') {
    const file = ctx.demoFiles?.[source.name];
    if (file === undefined)
      throw new ToolFailure('NOT_FOUND', `Demo dataset "${source.name}" is not bundled.`);
    items = parseFile(file, 'csv', ctx);
  } else {
    const file = resolveAllowedFile(source.path, ctx.allowedRoots);
    const ext = extname(file).slice(1).toLowerCase();
    const format = source.format ?? (ext === 'csv' || ext === 'json' ? ext : undefined);
    if (format === undefined) {
      throw new ToolFailure('FILE_NOT_ALLOWED', 'Only .csv and .json files are supported.', {
        details: { path: source.path },
      });
    }
    items = parseFile(file, format, ctx);
  }
  assertUniqueIds(items);
  return items;
}

export function resolveAllowedFile(path: string, allowedRoots: string[]): string {
  const deny = (reason: string): never => {
    throw new ToolFailure('FILE_NOT_ALLOWED', `File is not readable: ${reason}.`, {
      hint: 'Put the file inside one of files.allowedRoots in productops.config.json.',
      details: { path },
    });
  };
  if (path.includes('\0')) deny('invalid path');
  if (allowedRoots.length === 0) deny('no allowedRoots are configured');

  const roots = allowedRoots.flatMap((r) => {
    try {
      return [realpathSync(r)];
    } catch {
      return [];
    }
  });
  // Relative paths resolve against the first root; absolute paths must still land inside a root.
  const candidate = isAbsolute(path) ? path : resolve(roots[0] ?? allowedRoots[0]!, path);
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return deny('file does not exist');
  }
  const inside = roots.some((root) => {
    const rel = relative(root, real);
    return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
  });
  if (!inside) deny('path is outside allowedRoots');
  const stat = statSync(real);
  if (!stat.isFile()) deny('not a regular file');
  if (stat.size > MAX_FILE_BYTES) {
    throw new ToolFailure('INPUT_TOO_LARGE', `File is larger than ${MAX_FILE_BYTES} bytes.`, {
      details: { path },
    });
  }
  return real;
}

function parseFile(file: string, format: 'csv' | 'json', ctx: LoadContext): Initiative[] {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows: { row: Record<string, unknown>; line: number }[] = [];
  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new ToolFailure('FILE_PARSE_ERROR', `Invalid JSON: ${(err as Error).message}`);
    }
    const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items;
    if (!Array.isArray(list)) {
      throw new ToolFailure(
        'FILE_PARSE_ERROR',
        'JSON must be an array of initiatives or an object with "items".',
      );
    }
    list.forEach((row, i) => rows.push({ row: row as Record<string, unknown>, line: i + 1 }));
  } else {
    let records: Record<string, string>[];
    try {
      records = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      const e = err as Error & { lines?: number; column?: number };
      throw new ToolFailure('FILE_PARSE_ERROR', `Invalid CSV: ${e.message}`, {
        details: { line: e.lines, column: e.column },
      });
    }
    const unknown = records[0] ? Object.keys(records[0]).filter((k) => !KNOWN_FIELDS.has(k)) : [];
    if (unknown.length > 0) {
      ctx.warn({ code: 'UNKNOWN_COLUMNS', message: `Ignored columns: ${unknown.join(', ')}` });
    }
    records.forEach((rec, i) => rows.push({ row: coerceCsvRow(rec), line: i + 2 }));
  }

  if (rows.length === 0) throw new ToolFailure('VALIDATION_ERROR', 'The file contains no initiatives.');
  if (rows.length > MAX_INITIATIVES) {
    throw new ToolFailure('INPUT_TOO_LARGE', `At most ${MAX_INITIATIVES} initiatives are supported.`, {
      details: { count: rows.length },
    });
  }

  const issues: { line: number; path: string; message: string }[] = [];
  const items: Initiative[] = [];
  const truncated: string[] = [];
  for (const { row, line } of rows) {
    if (typeof row.title === 'string' && row.title.length > 200) {
      row.title = row.title.slice(0, 199) + '…';
      truncated.push(String(row.id));
    }
    const result = Initiative.safeParse(row);
    if (result.success) items.push(result.data);
    else
      for (const i of result.error.issues) issues.push({ line, path: i.path.join('.'), message: i.message });
  }
  if (issues.length > 0) {
    throw new ToolFailure('FILE_PARSE_ERROR', `${issues.length} problem(s) in the file.`, {
      details: { issues: issues.slice(0, 50) },
    });
  }
  if (truncated.length > 0) {
    ctx.warn({
      code: 'TITLE_TRUNCATED',
      message: 'Titles longer than 200 characters were cut.',
      itemIds: truncated,
    });
  }
  return items;
}

function coerceCsvRow(rec: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(rec)) {
    if (!KNOWN_FIELDS.has(key) || raw === '') continue;
    if (LIST_FIELDS.has(key)) {
      out[key] = raw
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (NUMBER_FIELDS.has(key)) {
      const n = Number(raw.replace(',', '.'));
      out[key] = Number.isFinite(n) ? n : raw;
    } else if (BOOLEAN_FIELDS.has(key)) {
      out[key] = /^(true|1|yes|y|да)$/i.test(raw) ? true : /^(false|0|no|n|нет)$/i.test(raw) ? false : raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function assertUniqueIds(items: Initiative[]): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const it of items) (seen.has(it.id) ? dupes : seen).add(it.id);
  if (dupes.size > 0) {
    throw new ToolFailure('VALIDATION_ERROR', 'Initiative ids must be unique.', {
      details: { duplicateIds: [...dupes] },
    });
  }
}
