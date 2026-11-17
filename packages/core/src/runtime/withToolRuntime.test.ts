import { describe, expect, it } from 'vitest';
import { ToolError } from '../schemas/errors.js';
import { Meta } from '../schemas/meta.js';
import { ToolFailure } from '../schemas/errors.js';
import { createLogger } from './logger.js';
import { createToolPolicy } from './policy.js';
import { INLINE_JSON_MAX_BYTES, withToolRuntime } from './withToolRuntime.js';

const logs: string[] = [];
const deps = {
  version: '1.2.3',
  logger: createLogger({ name: 'test', level: 'debug', write: (l) => logs.push(l) }),
  now: () => new Date('2026-01-01T00:00:00.000Z'),
};

describe('withToolRuntime', () => {
  it('returns structuredContent with a valid meta block and a text summary', async () => {
    const tool = withToolRuntime('echo', deps, async (input: { x: number }, ctx) => {
      ctx.warn({ code: 'SMALL_SAMPLE', message: 'only one item' });
      return { data: { doubled: input.x * 2 }, summary: 'doubled' };
    });
    const result = await tool({ x: 21 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ doubled: 42 });
    const meta = Meta.parse(result.structuredContent?.meta);
    expect(meta).toMatchObject({ tool: 'echo', version: '1.2.3', computedAt: '2026-01-01T00:00:00.000Z' });
    expect(meta.warnings).toEqual([{ code: 'SMALL_SAMPLE', message: 'only one item' }]);
    expect(result.content[0]?.text.startsWith('doubled\n\n{')).toBe(true);
  });

  it('produces the same inputHash regardless of key order', async () => {
    const tool = withToolRuntime('echo', deps, async () => ({ data: {}, summary: '' }));
    const a = await tool({ a: 1, b: { c: 2, d: 3 } });
    const b = await tool({ b: { d: 3, c: 2 }, a: 1 });
    expect(a.structuredContent).toEqual(b.structuredContent);
  });

  it('omits inline JSON from text when it exceeds the size limit', async () => {
    const tool = withToolRuntime('big', deps, async () => ({
      data: { blob: 'x'.repeat(INLINE_JSON_MAX_BYTES) },
      summary: 'big result',
    }));
    const result = await tool({});
    expect(result.content[0]?.text).toBe('big result');
  });

  it('maps ToolFailure to a ToolError result', async () => {
    const tool = withToolRuntime('fails', deps, async () => {
      throw new ToolFailure('VALIDATION_ERROR', 'effort must be positive', {
        details: { path: 'items.0.effort' },
      });
    });
    const result = await tool({});
    expect(result.isError).toBe(true);
    const body = ToolError.parse(result.structuredContent);
    expect(body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'effort must be positive',
      retryable: false,
      details: { path: 'items.0.effort' },
    });
  });

  it('maps unexpected exceptions to INTERNAL without leaking the message or stack', async () => {
    const tool = withToolRuntime('crash', deps, async () => {
      throw new Error('secret db path /home/x');
    });
    const result = await tool({});
    const body = ToolError.parse(result.structuredContent);
    expect(body.error.code).toBe('INTERNAL');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret db path');
    expect(serialized).not.toContain('at ');
    expect(logs.some((l) => l.includes('secret db path'))).toBe(true); // details stay in stderr logs
  });

  it('returns TIMEOUT and aborts the handler signal', async () => {
    let aborted = false;
    const tool = withToolRuntime(
      'slow',
      deps,
      (_input: object, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            resolve({ data: {}, summary: '' });
          });
        }),
      { timeoutMs: 20 },
    );
    const result = await tool({});
    expect(ToolError.parse(result.structuredContent).error).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
    expect(aborted).toBe(true);
  });

  it('returns PERMISSION_DENIED for tools blocked by policy without running them', async () => {
    let ran = false;
    const tool = withToolRuntime(
      'blocked',
      { ...deps, policy: createToolPolicy({ deny: ['block*'] }) },
      async () => {
        ran = true;
        return { data: {}, summary: '' };
      },
    );
    const result = await tool({});
    expect(ToolError.parse(result.structuredContent).error.code).toBe('PERMISSION_DENIED');
    expect(ran).toBe(false);
  });
});
