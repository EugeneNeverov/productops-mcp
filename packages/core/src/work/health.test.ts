import { describe, expect, it } from 'vitest';
import { findBlockers } from './blockers.js';
import { businessDaysBetween } from './calendar.js';
import { cycleStats, cycleTimes } from './cycle.js';
import { assessSprintHealth, HealthThresholds } from './health.js';
import { sprintScope, summarizeSprint } from './sprint.js';
import { item, sprint } from './testkit.js';

// Hand-calculated scenario. Every expected number below is worked out in the comments.
const NOW = new Date('2026-11-09T09:00:00.000Z'); // Monday
const S9 = sprint({
  id: 9,
  state: 'closed',
  startDate: '2026-10-19T09:00:00.000Z',
  endDate: '2026-11-02T09:00:00.000Z',
  completeDate: '2026-11-02T08:00:00.000Z',
});
const S10 = sprint({
  id: 10,
  state: 'active',
  startDate: '2026-11-02T09:00:00.000Z', // Monday
  endDate: '2026-11-16T09:00:00.000Z', // 10 working days later
});
const PLAN = '2026-11-01T12:00:00.000Z'; // Sunday before the start
const ip = 'In Progress';

const current = [
  item({
    key: 'A-1',
    points: 5,
    sprints: [[PLAN, [10], []]],
    moves: [
      ['2026-11-02T09:00:00.000Z', ip, 'in_progress'],
      ['2026-11-04T09:00:00.000Z', 'Done', 'done'],
    ],
  }),
  item({
    key: 'A-2',
    points: 3,
    sprints: [[PLAN, [10], []]],
    moves: [
      ['2026-11-03T09:00:00.000Z', ip, 'in_progress'],
      ['2026-11-06T09:00:00.000Z', 'Done', 'done'],
    ],
  }),
  item({
    key: 'A-3',
    points: 8,
    assignee: 'ann',
    flagged: true,
    sprints: [[PLAN, [10], []]],
    moves: [['2026-11-04T09:00:00.000Z', ip, 'in_progress']],
  }),
  item({ key: 'A-4', points: 2, createdAt: PLAN, sprints: [[PLAN, [10], []]], blockedBy: [['X-9', false]] }),
  item({
    key: 'A-5',
    points: 3,
    assignee: 'ann',
    sprints: [['2026-11-05T10:00:00.000Z', [10], []]],
    moves: [['2026-11-05T11:00:00.000Z', ip, 'in_progress']],
  }),
  item({ key: 'A-6', type: 'Bug', points: null, sprints: [[PLAN, [10], []]] }),
  item({
    key: 'A-7',
    points: 5,
    sprints: [
      [PLAN, [10], []],
      ['2026-11-03T12:00:00.000Z', [], [10]],
    ],
  }),
  item({
    key: 'A-8',
    points: 2,
    assignee: 'ann',
    sprints: [
      ['2026-10-20T09:00:00.000Z', [9], []],
      [PLAN, [10], []],
    ],
    moves: [['2026-11-02T10:00:00.000Z', ip, 'in_progress']],
  }),
];

// Baseline: five items started Tue 2026-10-20 09:00 and finished after 1..5 working days.
const doneOn = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'];
const baseline = doneOn.map((d, i) =>
  item({
    key: `B-${i + 1}`,
    points: 3,
    sprints: [['2026-10-18T12:00:00.000Z', [9], []]],
    moves: [
      ['2026-10-20T09:00:00.000Z', ip, 'in_progress'],
      [`${d}T09:00:00.000Z`, 'Done', 'done'],
    ],
  }),
);

describe('businessDaysBetween', () => {
  it('skips weekends and counts partial days', () => {
    expect(businessDaysBetween('2026-11-02T09:00:00Z', '2026-11-16T09:00:00Z')).toBe(10);
    expect(businessDaysBetween('2026-11-06T12:00:00Z', '2026-11-09T12:00:00Z')).toBe(1); // Fri noon → Mon noon
    expect(businessDaysBetween('2026-11-07T00:00:00Z', '2026-11-08T23:00:00Z')).toBe(0); // weekend
    expect(businessDaysBetween('2026-11-09T00:00:00Z', '2026-11-08T00:00:00Z')).toBe(0);
  });
});

describe('sprint scope', () => {
  const scope = sprintScope(current, S10, NOW, 9);
  it('separates the starting scope from changes after the start', () => {
    expect(scope.members.map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-8']);
    expect(scope.atStart.map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-6', 'A-7', 'A-8']);
    expect(scope.addedAfterStart.map((i) => i.key)).toEqual(['A-5']);
    expect(scope.removedAfterStart.map((i) => i.key)).toEqual(['A-7']);
    expect(scope.carriedOver.map((i) => i.key)).toEqual(['A-8']);
  });
  it('summarizes counts and points of the current scope', () => {
    expect(summarizeSprint(scope)).toEqual({
      counts: { total: 7, byCategory: { todo: 2, in_progress: 3, done: 2 }, byType: { Bug: 1, Story: 6 } },
      // 5+3+8+2+3+0+2 = 23 committed, A-1 + A-2 = 8 completed, A-6 unestimated
      estimate: { committed: 23, completed: 8, unit: 'story_points', unestimatedCount: 1 },
    });
  });
});

describe('findBlockers', () => {
  it('assigns signals and severity', () => {
    const blockers = findBlockers(sprintScope(current, S10, NOW).members, {
      now: NOW,
      staleDays: 3,
      blockedStatuses: ['Blocked'],
    });
    expect(blockers.map((b) => [b.item.key, b.signals, b.severity, b.daysInCurrentStatus])).toEqual([
      // flagged + 3 working days in progress (Wed → Mon) → 2 signals → high
      ['A-3', ['FLAGGED', 'STALE_IN_PROGRESS'], 'high', 3],
      // open blocking link, 2 pts < sprint median 3, 5.375 days since creation → medium
      ['A-4', ['BLOCKED_BY_OPEN_LINK'], 'medium', 5.38],
      // in progress since Mon 10:00: 14/24 + 4 + 9/24 days → stale, medium
      ['A-8', ['STALE_IN_PROGRESS'], 'medium', 4.96],
    ]);
    expect(blockers[1]!.blockedBy).toEqual([{ key: 'X-9', done: false }]);
  });
});

describe('cycle time', () => {
  it('measures first in_progress to last done in working days', () => {
    const { records, population } = cycleTimes(baseline);
    expect(records.map((r) => r.days)).toEqual([1, 2, 3, 4, 5]);
    expect(population).toEqual({ completed: 5, excludedNoStart: 0, reopened: 0 });
    expect(cycleStats([1, 2, 3, 4, 5], [50, 85])).toEqual({
      count: 5,
      p: { p50: 3, p85: 4.4 },
      mean: 3,
      max: 5,
    });
  });
  it('counts reopened items once and excludes items that never started', () => {
    const reopened = item({
      key: 'R-1',
      moves: [
        ['2026-11-02T09:00:00Z', ip, 'in_progress'],
        ['2026-11-03T09:00:00Z', 'Done', 'done'],
        ['2026-11-04T09:00:00Z', ip, 'in_progress'],
        ['2026-11-05T09:00:00Z', 'Done', 'done'],
      ],
    });
    const skipped = item({ key: 'R-2', moves: [['2026-11-02T09:00:00Z', 'Done', 'done']] });
    const { records, population } = cycleTimes([reopened, skipped]);
    expect(population).toEqual({ completed: 1, excludedNoStart: 1, reopened: 1 });
    expect(records[0]!.days).toBe(3);
    expect(records[0]!.inStatus).toEqual({ [ip]: 2, Done: 1 });
  });
  it('returns null percentiles for small samples', () => {
    expect(cycleStats([1, 2], [85]).p).toEqual({ p85: null });
  });
});

describe('assessSprintHealth', () => {
  const result = assessSprintHealth({
    current: { sprint: S10, items: current },
    baseline: [{ sprint: S9, items: [...baseline, current[7]!] }],
    now: NOW,
    thresholds: HealthThresholds.parse({}),
    staleDays: 3,
    blockedStatuses: ['Blocked'],
  });
  it('computes the metrics', () => {
    expect(result.elapsedPct).toBe(50); // 5 of 10 working days
    expect(result.metrics).toEqual({
      completionPct: 34.8, // 8 / 23
      scopeChangePct: 32, // (A-5 3 + A-7 5) / starting 25
      carryOverFromPrevious: 1, // A-8
      wip: { current: 3, perAssigneeMax: 3 },
      blockersHigh: 1,
      cycleTimeP85VsBaseline: null, // only 2 completed items this sprint
      unestimatedPct: 14.3, // 1 of 7
    });
  });
  it('rates the checks and the score', () => {
    expect(result.checks.map((c) => [c.id, c.status, c.value])).toEqual([
      ['BURNDOWN_LAG', 'warn', 15.2],
      ['SCOPE_CREEP', 'risk', 32],
      ['BLOCKERS', 'warn', 1],
      ['WIP_OVERLOAD', 'warn', 3],
      ['CYCLE_TIME_REGRESSION', 'ok', null],
      ['ESTIMATION_GAPS', 'warn', 14.3],
      ['CARRY_OVER', 'warn', 14.3], // 1 of 7 at start
    ]);
    expect(result.healthScore).toBe(50); // 100 − 5×7 − 15
    expect(result.warnings.map((w) => w.code)).toEqual(['SMALL_SAMPLE']);
    expect(result.checks[1]!.evidence.map((i) => i.key)).toEqual(['A-5', 'A-7']);
    expect(result.checks[0]!.evidence.map((i) => i.key)).toEqual(['A-3', 'A-5', 'A-4', 'A-8', 'A-6']);
  });
  it('warns when there is no baseline and no previous sprint', () => {
    const r = assessSprintHealth({
      current: { sprint: S10, items: current },
      baseline: [],
      now: NOW,
      thresholds: HealthThresholds.parse({}),
      staleDays: 3,
      blockedStatuses: [],
    });
    expect(r.warnings.map((w) => w.code)).toEqual(['NO_BASELINE', 'NO_PREVIOUS_SPRINT']);
    expect(r.metrics.carryOverFromPrevious).toBe(0);
  });
});
