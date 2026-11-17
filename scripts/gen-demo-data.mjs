#!/usr/bin/env node
// Generates the synthetic "saas-roadmap" demo dataset with a fixed seed.
// Output is fully synthetic: no real company, product or person.
// Usage: node scripts/gen-demo-data.mjs  (rewrites packages/mcp-prioritization/demo-data/saas-roadmap.csv)
import { writeFileSync } from 'node:fs';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261117);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const TITLES = {
  Growth: [
    'Self-serve onboarding checklist',
    'Annual plan discount at checkout',
    'In-app referral program',
    'Usage-based pricing tier',
    'Trial expiry email sequence',
    'Pricing page A/B test framework',
    'Team invite flow redesign',
    'Product tour for new workspaces',
    'Win-back campaign for churned accounts',
    'Self-serve plan upgrade in app',
    'Localized checkout (EU currencies)',
    'Partner marketplace listing',
    'Account health score for CSMs',
  ],
  Platform: [
    'SSO with SAML for enterprise',
    'Audit log export',
    'Public REST API v2',
    'Webhooks with retries',
    'Data residency in EU region',
    'Role-based access control',
    'SOC 2 evidence automation',
    'Search indexing rewrite',
    'Rate limiting for public API',
    'Background job queue migration',
    'Customer-managed encryption keys',
    'Bulk import from CSV',
    'Usage metering service',
    'Status page and incident comms',
  ],
  Mobile: [
    'Offline mode for mobile',
    'Push notification preferences',
    'Mobile dark mode',
    'Biometric login',
    'iPad layout',
    'Mobile file attachments',
    'Home screen widgets',
    'Mobile onboarding redesign',
    'Crash reporting dashboard',
    'In-app feedback widget',
    'Mobile search',
    'Deep links from email',
    'Accessibility pass (screen readers)',
  ],
};

const IMPACT = [0.25, 0.5, 1, 1, 2, 2, 3];
const FIB = [1, 2, 3, 5, 8, 13, 20];
const fibWeighted = () => FIB[Math.min(6, Math.floor(rnd() ** 1.4 * 7))];

const rows = [];
let n = 1;
for (const [team, titles] of Object.entries(TITLES)) {
  for (const title of titles) {
    const effort = Math.round((0.5 + rnd() ** 1.6 * 7.5) * 2) / 2; // 0.5–8 person-months
    rows.push({
      id: `INIT-${String(n++).padStart(3, '0')}`,
      title,
      team,
      tags: pick(['retention', 'acquisition', 'enterprise', 'quality', 'monetization']),
      reach: Math.round((200 + rnd() ** 2 * 9800) / 50) * 50,
      impact: pick(IMPACT),
      confidence: pick([0.3, 0.5, 0.5, 0.8, 0.8, 0.8, 1]),
      effort,
      businessValue: fibWeighted(),
      timeCriticality: fibWeighted(),
      riskReductionOpportunity: fibWeighted(),
      jobSize: FIB.reduce(
        (best, f) => (Math.abs(f - effort * 2.5) < Math.abs(best - effort * 2.5) ? f : best),
        1,
      ),
      dependsOn: [],
      mandatory: false,
    });
  }
}
const byTitle = (t) => rows.find((r) => r.title === t);
// Hand-picked, plausible dependencies and two mandatory (compliance / contractual) items.
byTitle('Audit log export').dependsOn.push(byTitle('Role-based access control').id);
byTitle('SOC 2 evidence automation').dependsOn.push(byTitle('Audit log export').id);
byTitle('Webhooks with retries').dependsOn.push(byTitle('Background job queue migration').id);
byTitle('Usage-based pricing tier').dependsOn.push(byTitle('Usage metering service').id);
byTitle('Self-serve plan upgrade in app').dependsOn.push(byTitle('Usage-based pricing tier').id);
byTitle('Rate limiting for public API').dependsOn.push(byTitle('Public REST API v2').id);
byTitle('Partner marketplace listing').dependsOn.push(byTitle('Public REST API v2').id);
byTitle('Deep links from email').dependsOn.push(byTitle('Mobile onboarding redesign').id);
byTitle('Data residency in EU region').mandatory = true;
byTitle('SSO with SAML for enterprise').mandatory = true;

const cols = Object.keys(rows[0]);
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv =
  [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => esc(Array.isArray(r[c]) ? r[c].join(';') : r[c])).join(',')),
  ].join('\n') + '\n';
writeFileSync(new URL('../packages/mcp-prioritization/demo-data/saas-roadmap.csv', import.meta.url), csv);
console.log(`wrote ${rows.length} initiatives`);
