import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createToolPolicy } from './policy.js';

describe('tool policy', () => {
  it('allows everything by default', () => {
    expect(createToolPolicy().isAllowed('calculate_rice')).toBe(true);
  });

  it('applies deny after allow, with * globs', () => {
    const p = createToolPolicy({ allow: ['calculate_*', 'ping'], deny: ['calculate_wsjf'] });
    expect(p.isAllowed('calculate_rice')).toBe(true);
    expect(p.isAllowed('calculate_wsjf')).toBe(false);
    expect(p.isAllowed('simulate_capacity')).toBe(false);
  });

  it('treats regex characters in names literally', () => {
    expect(createToolPolicy({ allow: ['a.b'] }).isAllowed('axb')).toBe(false);
  });
});

describe('loadConfig', () => {
  it('returns defaults when PRODUCTOPS_CONFIG is unset', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      tools: { allow: ['*'], deny: [] },
      writes: { enabled: false },
      files: { allowedRoots: ['./data'] },
      jira: {
        mode: 'fixtures',
        sites: [],
        budget: { maxCallsPerTool: 600 },
        returnText: { maxChars: 500 },
        people: 'displayName',
        blockedStatuses: ['Blocked'],
      },
    });
    expect(config.jira.health.thresholds.SCOPE_CREEP).toEqual({ warn: 10, risk: 25 });
  });

  it('rejects a config that tries to enable writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'po-'));
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ writes: { enabled: true } }));
    expect(() => loadConfig({ PRODUCTOPS_CONFIG: file })).toThrow(/Invalid config/);
  });
});
