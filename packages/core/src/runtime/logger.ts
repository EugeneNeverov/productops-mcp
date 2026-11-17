/**
 * JSON-lines logger that writes to stderr only. stdout belongs to the MCP stdio protocol,
 * so nothing in this repository may write there (enforced by eslint `no-console` and an e2e test).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SECRET_KEY = /^(authorization|access_?token|refresh_?token|client_?secret|password|api_?key|token)$/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return value.replace(BEARER, '$1 [REDACTED]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: value.stack };
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  write?: (line: string) => void;
}

function parseLevel(raw: string | undefined): LogLevel {
  return raw !== undefined && raw in ORDER ? (raw as LogLevel) : 'info';
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? parseLevel(process.env.PRODUCTOPS_LOG_LEVEL);
  const write = options.write ?? ((line: string) => process.stderr.write(line + '\n'));
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const record = { ts: new Date().toISOString(), level: lvl, logger: options.name, msg, ...(fields ?? {}) };
    write(JSON.stringify(redact(record)));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
