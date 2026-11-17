import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkReport, numberMatches } from './checks.mjs';

const root = new URL('../../', import.meta.url);
const tools = [
  'calculate_rice',
  'calculate_wsjf',
  'compare_initiatives',
  'simulate_capacity',
  'explain_ranking',
];
const calls = tools.map((name) => {
  const ref = JSON.parse(readFileSync(new URL(`examples/reports/demo/${name}.json`, root), 'utf8'));
  return { name, args: ref.request, result: ref.response };
});
const report = readFileSync(new URL('skills/roadmap-prioritization/examples/demo-report.md', root), 'utf8');
const prompt =
  'Demo backlog, capacity Growth 10, Platform 12, Mobile 12. What if 20% fewer people or estimates 30% low?';
const check = (r, expect = {}) =>
  checkReport({ skill: 'roadmap-prioritization', report: r, prompt, calls, expect });
const failed = (res) => res.checks.filter((c) => !c.passed).map((c) => c.id);

describe('eval checks', () => {
  it('pass for the example report in skills/roadmap-prioritization/examples', () => {
    const res = check(report, { mustCall: ['simulate_capacity'], mustMention: ['INIT-014', 'INIT-018'] });
    expect(failed(res)).toEqual([]);
  });

  it('catch a number the tools never produced', () => {
    const res = check(report.replace('Kendall tau 0.3308', 'Kendall tau 0.4123'));
    expect(failed(res)).toEqual(['numbers-from-tools']);
    expect(res.checks.find((c) => c.id === 'numbers-from-tools').details).toContain('0.4123');
  });

  it('catch an invented initiative id', () => {
    expect(failed(check(report.replaceAll('INIT-022', 'INIT-099')))).toEqual(['ids-from-tools']);
  });

  it('catch a missing section, an over-long report and an uncited hash', () => {
    const noTradeoffs = report.replace('## Trade-offs', '## Notes');
    expect(failed(check(noTradeoffs))).toEqual(['sections']);
    expect(failed(check(report, { maxWords: 100 }))).toEqual(['length']);
    expect(failed(check(report.replace(/sha256:[0-9a-f]+/g, '')))).toEqual(['cites-input-hash']);
  });

  it('check required tool calls, clarifying questions and forbidden phrases', () => {
    const q = checkReport({
      skill: 'roadmap-prioritization',
      report: 'How much capacity does each team have?',
      prompt: 'x',
      calls: [],
      expect: { asksQuestion: true, mustNotCall: ['simulate_capacity'] },
    });
    expect(q.passed).toBe(true);
    expect(
      failed(check(report, { mustCall: ['calculate_wsjf_v9'], forbid: ['Home screen widgets'] })),
    ).toEqual(['calls:calculate_wsjf_v9', 'forbid:Home screen widgets']);
  });

  it('match rounding, percentages of ratios and multipliers', () => {
    expect(numberMatches('0.33', [1 / 3])).toBe(true);
    expect(numberMatches('50%', [0.5])).toBe(true);
    expect(numberMatches('30%', [1.3])).toBe(true);
    expect(numberMatches('16.67%', [-16.67])).toBe(true);
    expect(numberMatches('0.34', [1 / 3])).toBe(false);
  });
});
