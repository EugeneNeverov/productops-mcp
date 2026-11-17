#!/usr/bin/env node
/**
 * Seeds an EMPTY test Jira Cloud site with a small demo Scrum sprint, so the
 * Jira Product Intelligence MCP and the sprint-health-audit skill can be tried
 * against real data (stage 4 spike, docs/decisions/0002-jira-via-atlassian-mcp.md).
 *
 * This script WRITES to Jira. It is a dev tool, not part of any published package.
 * Dry run is the default; pass --apply to write.
 *
 * Usage (PowerShell):
 *   $env:JIRA_SITE="https://your-site.atlassian.net"
 *   $env:JIRA_EMAIL="you@example.com"
 *   $env:JIRA_API_TOKEN="..."   # https://id.atlassian.com/manage-profile/security/api-tokens
 *   node scripts/seed-jira-demo.mjs --project SCRUM            # dry run
 *   node scripts/seed-jira-demo.mjs --project SCRUM --apply    # write
 *
 * What it creates (all labelled "productops-demo"):
 *   - 3 epics, 16 stories with story points, 3 bugs without estimates (a data-quality gap)
 *   - "PO Demo Sprint 1": 12 issues, started, then 4 done, 3 in progress, 1 flagged,
 *     2 issues added after the start (scope creep) and 1 removed back to the backlog
 *   - the rest stays in the backlog
 * Re-running refuses if demo issues already exist (pass --force to add another set).
 */
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

const LABEL = 'productops-demo';
const SPRINT_NAME = 'PO Demo Sprint 1';
const SPRINT_DAYS = 14;

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const force = Boolean(args.force);
const projectKey = String(args.project ?? '').toUpperCase();

const site = (process.env.JIRA_SITE ?? '').replace(/\/+$/, '');
const email = process.env.JIRA_EMAIL ?? '';
const token = process.env.JIRA_API_TOKEN ?? '';

if (!projectKey || !site || !email || !token) {
  console.error(
    'Need --project KEY and env JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN. See the header of this file for usage.',
  );
  process.exit(2);
}
if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(site)) {
  console.error(`JIRA_SITE must look like https://<name>.atlassian.net, got "${site}".`);
  process.exit(2);
}

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

const EPICS = [
  { key: 'onboarding', summary: 'Self-serve onboarding' },
  { key: 'billing', summary: 'Usage-based billing' },
  { key: 'reports', summary: 'Team analytics reports' },
];

// sprint: initial sprint scope; plan: what happens to it after the sprint starts.
const STORIES = [
  { epic: 'onboarding', summary: 'Sign-up with Google account', points: 3, sprint: true, plan: 'done' },
  { epic: 'onboarding', summary: 'Workspace setup wizard', points: 8, sprint: true, plan: 'progress' },
  { epic: 'onboarding', summary: 'Invite teammates by link', points: 5, sprint: true, plan: 'done' },
  { epic: 'onboarding', summary: 'Sample project on first login', points: 3, sprint: true, plan: 'todo' },
  { epic: 'onboarding', summary: 'Onboarding checklist widget', points: 5, sprint: false },
  { epic: 'billing', summary: 'Metered usage events pipeline', points: 13, sprint: true, plan: 'flagged' },
  { epic: 'billing', summary: 'Invoice PDF generation', points: 5, sprint: true, plan: 'progress' },
  { epic: 'billing', summary: 'Card update flow', points: 3, sprint: true, plan: 'done' },
  { epic: 'billing', summary: 'Proration on plan change', points: 8, sprint: true, plan: 'removed' },
  { epic: 'billing', summary: 'Tax rates by region', points: 5, sprint: false },
  { epic: 'reports', summary: 'Cycle time chart', points: 5, sprint: true, plan: 'progress' },
  { epic: 'reports', summary: 'CSV export of reports', points: 2, sprint: true, plan: 'done' },
  { epic: 'reports', summary: 'Weekly email digest', points: 3, sprint: true, plan: 'todo' },
  { epic: 'reports', summary: 'Custom date ranges', points: 2, sprint: false, plan: 'added' },
  { epic: 'reports', summary: 'Dashboard sharing permissions', points: 5, sprint: false, plan: 'added' },
  { epic: 'reports', summary: 'Report caching layer', points: 8, sprint: false },
];

const BUGS = [
  { summary: 'Wizard loses state on browser back', sprint: true, plan: 'todo' },
  { summary: 'Invoice totals off by one cent', sprint: false },
  { summary: 'Chart tooltip overlaps legend on mobile', sprint: false },
];

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

async function main() {
  log(`${apply ? 'APPLY' : 'DRY RUN'}: seeding ${site} project ${projectKey}`);

  const me = await jira('GET', '/rest/api/3/myself');
  log(`Signed in as ${me.displayName}`);

  const project = await jira('GET', `/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  const style = project.style; // "next-gen" (team-managed) or "classic" (company-managed)
  log(`Project "${project.name}" (${style === 'next-gen' ? 'team-managed' : 'company-managed'})`);

  const types = await jira('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`);
  const typeId = (name) => {
    // Match the English name even when the site UI is localized (e.g. "Эпик", "История").
    const t = types.find((x) =>
      [x.untranslatedName, x.name].some((n) => String(n ?? '').toLowerCase() === name),
    );
    if (!t)
      throw new Error(
        `Issue type "${name}" not found in ${projectKey}. Available: ${types.map((x) => x.name).join(', ')}`,
      );
    return t.id;
  };
  const epicType = typeId('epic');
  const storyType = typeId('story');
  const bugType = typeId('bug');

  const boards = await jira(
    'GET',
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum`,
  );
  const board = boards.values?.[0];
  if (!board)
    throw new Error(`No Scrum board for ${projectKey}. Create the project from the Scrum template.`);
  log(`Board #${board.id} "${board.name}"`);

  const pointsField = await findStoryPointsField();
  log(
    pointsField
      ? `Story points field: ${pointsField.name} (${pointsField.id})`
      : 'Story points field: NOT FOUND',
  );
  if (!pointsField) throw new Error('No story points field found; enable estimation on the board first.');
  const flaggedField = await findField((f) => [f.untranslatedName, f.name].includes('Flagged'));
  log(
    flaggedField ? `Flagged field: ${flaggedField.id}` : 'Flagged field: not found, will use label "blocked"',
  );

  const existing = await jira('POST', '/rest/api/3/search/jql', {
    jql: `project = ${projectKey} AND labels = ${LABEL}`,
    maxResults: 1,
    fields: ['summary'],
  });
  if ((existing.issues?.length ?? 0) > 0 && !force) {
    throw new Error(
      `Demo issues (label ${LABEL}) already exist in ${projectKey}. Pass --force to add another set.`,
    );
  }

  const total = EPICS.length + STORIES.length + BUGS.length;
  log(
    `Plan: ${EPICS.length} epics, ${STORIES.length} stories, ${BUGS.length} bugs (${total} issues), sprint "${SPRINT_NAME}"`,
  );
  if (!apply) {
    log('Dry run finished; nothing was written. Re-run with --apply to create the data.');
    return;
  }

  const epicKeys = {};
  for (const e of EPICS) {
    epicKeys[e.key] = await createIssue({ summary: e.summary, issuetype: { id: epicType } });
  }

  const created = [];
  for (const s of STORIES) {
    const key = await createIssue({
      summary: s.summary,
      issuetype: { id: storyType },
      parent: { key: epicKeys[s.epic] },
      [pointsField.id]: s.points,
    });
    created.push({ ...s, key });
  }
  for (const b of BUGS) {
    const key = await createIssue({ summary: b.summary, issuetype: { id: bugType } });
    created.push({ ...b, key });
  }

  // Use Jira's clock, not the local one: a local clock running ahead makes the
  // "added after start" scope changes look as if they happened before the sprint began.
  // Back-date by a minute for extra margin.
  const { serverTime } = await jira('GET', '/rest/api/3/serverInfo');
  const start = new Date(new Date(serverTime).getTime() - 60_000);
  const end = new Date(start.getTime() + SPRINT_DAYS * 86_400_000);
  const sprint = await jira('POST', '/rest/agile/1.0/sprint', {
    name: SPRINT_NAME,
    originBoardId: board.id,
    goal: 'Ship onboarding wizard and first billing invoices',
  });
  log(`Sprint #${sprint.id} created`);

  const initial = created.filter((i) => i.sprint).map((i) => i.key);
  await jira('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: initial });
  await jira('POST', `/rest/agile/1.0/sprint/${sprint.id}`, {
    state: 'active',
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  log(`Sprint started with ${initial.length} issues`);
  await sleep(1500); // let Jira record the sprint start before scope changes

  const added = created.filter((i) => i.plan === 'added').map((i) => i.key);
  if (added.length) await jira('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: added });
  const removed = created.filter((i) => i.plan === 'removed').map((i) => i.key);
  if (removed.length) await jira('POST', '/rest/agile/1.0/backlog/issue', { issues: removed });
  log(`Scope change: +${added.length} added, -${removed.length} removed after start`);

  for (const i of created) {
    if (i.plan === 'progress' || i.plan === 'flagged') await transitionTo(i.key, 'indeterminate');
    if (i.plan === 'done') {
      await transitionTo(i.key, 'indeterminate');
      await transitionTo(i.key, 'done');
    }
    if (i.plan === 'flagged') await flag(i.key, flaggedField);
  }

  log(`Done. Board: ${site}/jira/software/projects/${projectKey}/boards/${board.id}`);
  log(`Created ${created.length + EPICS.length} issues with label ${LABEL}.`);
}

async function createIssue(fields) {
  const res = await jira('POST', '/rest/api/3/issue', {
    fields: { project: { key: projectKey }, labels: [LABEL], ...fields },
  });
  log(`  created ${res.key} ${fields.summary}`);
  return res.key;
}

async function transitionTo(issueKey, categoryKey) {
  const { transitions } = await jira('GET', `/rest/api/3/issue/${issueKey}/transitions`);
  const t = transitions.find((x) => x.to?.statusCategory?.key === categoryKey);
  if (!t) {
    log(`  ${issueKey}: no transition to a "${categoryKey}" status, skipped`);
    return;
  }
  await jira('POST', `/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: t.id } });
  log(`  ${issueKey} -> ${t.to.name}`);
}

async function flag(issueKey, flaggedField) {
  if (flaggedField) {
    try {
      await jira('PUT', `/rest/api/3/issue/${issueKey}`, {
        fields: { [flaggedField.id]: [{ value: 'Impediment' }] },
      });
      log(`  ${issueKey} flagged`);
      return;
    } catch (err) {
      log(
        `  ${issueKey}: could not set Flagged (${err instanceof Error ? err.message.slice(0, 120) : err}), using label`,
      );
    }
  }
  await jira('PUT', `/rest/api/3/issue/${issueKey}`, { update: { labels: [{ add: 'blocked' }] } });
  log(`  ${issueKey} labelled blocked`);
}

let fieldsCache;
async function findField(pred) {
  fieldsCache ??= await jira('GET', '/rest/api/3/field');
  return fieldsCache.find(pred);
}

function findStoryPointsField() {
  // Prefer the Jira Software story points type; fall back to the English names
  // ("Story point estimate" in team-managed, "Story Points" in company-managed projects).
  const names = ['story point estimate', 'story points'];
  return findField(
    (f) =>
      f.schema?.custom === 'com.pyxis.greenhopper.jira:jsw-story-points' ||
      [f.untranslatedName, f.name].some((n) => names.includes(String(n ?? '').toLowerCase())),
  );
}

async function jira(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(site + path, {
      method,
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? attempt * 2) * 1000;
      log(`  rate limited, waiting ${wait} ms`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}

function log(msg) {
  console.log(msg);
}
