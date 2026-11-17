import { describe, expect, it } from 'vitest';
import { JiraConfig } from '@productops/core';
import { DEMO_FIXTURES, FixtureSource, loadFixtureFile } from '../source/fixtures.js';
import { Normalizer } from '../source/normalize.js';
import { Session } from '../source/types.js';
import { CachingSource, TTL } from './caching.js';
import { auditCsv, openStore } from './store.js';

describe('sqlite store', () => {
  it('caches values until their TTL and prunes on open', async () => {
    const store = await openStore(':memory:', { retentionDays: 30, now: 0 });
    expect(store.kind).toBe('sqlite');
    store.cacheSet('k', { a: [1, 2] }, 10, 1_000);
    expect(store.cacheGet('k', 5_000)).toEqual({ value: { a: [1, 2] }, fetchedAt: 1_000 });
    expect(store.cacheGet('k', 12_000)).toBeUndefined();
    expect(store.cacheClear()).toBe(1);
    store.close();
  });

  it('keeps an audit log without arguments and exports CSV', async () => {
    const store = await openStore(':memory:', { retentionDays: 30 });
    store.audit({
      ts: '2026-11-17T10:00:00.000Z',
      tool: 'find_blockers',
      inputHash: 'sha256:ab',
      outcome: 'ok',
      durationMs: 12.4,
      upstreamCalls: 9,
    });
    expect(auditCsv(store.auditRows())).toBe(
      'ts,tool,input_hash,outcome,duration_ms,upstream_calls\n2026-11-17T10:00:00.000Z,find_blockers,sha256:ab,ok,12,9\n',
    );
    store.close();
  });
});

describe('CachingSource', () => {
  const config = JiraConfig.parse({});
  const make = async () => {
    const store = await openStore(':memory:', { retentionDays: 30 });
    const inner = new FixtureSource(loadFixtureFile(DEMO_FIXTURES), new Normalizer(config));
    return { store, source: new CachingSource(inner, store) };
  };

  it('serves a repeated read from the cache with zero upstream calls', async () => {
    const { source } = await make();
    const first = new Session(1000);
    const items = await source.sprintItems(1, 5, first);
    expect(first.calls).toBeGreaterThan(0);
    expect(first.cacheHits).toBe(0);
    const second = new Session(1000);
    expect(await source.sprintItems(1, 5, second)).toEqual(items);
    expect(second.calls).toBe(0);
    expect(second.cacheHits).toBeGreaterThan(0);
    // The sanitizer's finding survives the cache.
    expect([...second.suspiciousKeys]).toEqual([...first.suspiciousKeys]);
    expect(second.suspiciousKeys.size).toBe(1);
  });

  it('bypasses the cache on refresh', async () => {
    const { source } = await make();
    await source.sprintItems(1, 4, new Session(1000));
    const again = new Session(1000);
    again.refresh = true;
    await source.sprintItems(1, 4, again);
    expect(again.cacheHits).toBe(0);
    expect(again.calls).toBeGreaterThan(0);
  });

  it('keeps closed sprints for a week and active ones for minutes', () => {
    expect(TTL.closedSprintItems).toBe(604_800);
    expect(TTL.activeSprintItems).toBe(300);
  });
});
