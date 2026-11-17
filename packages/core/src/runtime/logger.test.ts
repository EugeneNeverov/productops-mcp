import { describe, expect, it } from 'vitest';
import { createLogger, redact } from './logger.js';

describe('logger', () => {
  it('redacts secret keys and bearer tokens', () => {
    expect(
      redact({
        headers: { Authorization: 'Bearer abc.def' },
        refresh_token: 'r',
        note: 'sent Bearer xyz123',
      }),
    ).toEqual({
      headers: { Authorization: '[REDACTED]' },
      refresh_token: '[REDACTED]',
      note: 'sent Bearer [REDACTED]',
    });
  });

  it('writes JSON lines and respects the level', () => {
    const lines: string[] = [];
    const log = createLogger({ name: 't', level: 'warn', write: (l) => lines.push(l) });
    log.info('hidden');
    log.warn('shown', { client_secret: 's' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'warn',
      logger: 't',
      msg: 'shown',
      client_secret: '[REDACTED]',
    });
  });
});
