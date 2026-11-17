# ADR 0003: Cache and audit log in the built-in `node:sqlite`

Status: accepted, 2026-11-17. Answers spec §13 question 6.

## Context

`productops-jira` in live mode spends Rovo credits on every upstream call (ADR 0002). Closed sprints do not change, so reading them again is waste. The spec (§7.4, §9) also asks for a local audit log of tool calls without arguments or content. Both need a small local database. The candidates were `better-sqlite3` (a native addon, prebuilt binaries per platform and Node version) and Node's built-in `node:sqlite`.

## Decision

- Use `node:sqlite` (`DatabaseSync`), loaded with a dynamic `import()`. It has no install step and no native build, which matters for `npx productops-jira` on Windows.
- `node:sqlite` exists from Node 22.13 (behind no flag) and prints an `ExperimentalWarning` to stderr in some versions. stderr is not part of the MCP stdio protocol, so the warning is harmless.
- On Node 20, where the module is missing, the server runs without a store: no cache, no audit log, a warning in the server log. Tools work the same and report `fromCache: false`.
- The store is used **in live mode only**. Fixtures mode needs neither a cache nor an audit trail, and stays deterministic.
- One file, `cache.db`, next to the credentials (`~/.productops/` or `$PRODUCTOPS_HOME`), directory 0700, file 0600.

Tables:

| Table       | Columns                                                      | Notes                                                   |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `cache`     | `key, value_json_gz, fetched_at, ttl_s`                      | key = sha256 of mode, cloudId, operation and parameters |
| `audit_log` | `ts, tool, input_hash, outcome, duration_ms, upstream_calls` | no arguments, no content; pruned after `retentionDays`  |

TTLs follow spec §7.4: site and projects 1 h, sprint list 15 min, items of an active sprint 5 min, of a closed sprint 7 days, completed-items windows 1 h. `refresh: true` skips cache reads and writes fresh data. Sanitizer findings (`SUSPICIOUS_CONTENT`) and gap warnings are cached together with the data, so a cached answer carries the same warnings as a fresh one.

## Consequences

- `meta.source.fromCache` is true when any part of the answer came from the cache, and `fetchedAt` is the oldest cached part.
- No `etag` column: the Atlassian MCP tools do not return ETags (spike, 2026-11-17).
- Expired rows are deleted when the store opens. `productops-jira cache clear` empties the cache, `productops-jira logout` also clears it, and `productops-jira audit export` prints the log as CSV.
- If `node:sqlite` changes its API before it is stable, only `packages/mcp-jira/src/store/store.ts` needs to change.
