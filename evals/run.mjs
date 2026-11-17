#!/usr/bin/env node
// Runs a skill's eval cases against a model and the real MCP server.
//
//   node evals/run.mjs roadmap-prioritization|sprint-health-audit [--case <id>] [--repeat 1]
//
// Environment:
//   EVAL_BASE_URL  OpenAI-compatible endpoint (default http://localhost:1234/v1, LM Studio)
//   EVAL_MODEL     model id as the endpoint knows it (required)
//   EVAL_API_KEY   bearer token, if the endpoint needs one
//
// Writes evals/results/<skill>-<model>-<timestamp>.json and prints a summary table.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { runAgent } from './lib/agent.mjs';
import { checkReport } from './lib/checks.mjs';

// Each skill runs against its server on the bundled demo data (the Jira server in fixtures mode).
const SERVERS = {
  'roadmap-prioritization': 'packages/mcp-prioritization/dist/bin.js',
  'sprint-health-audit': 'packages/mcp-jira/dist/bin.js',
};
const root = new URL('../', import.meta.url);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { case: { type: 'string' }, repeat: { type: 'string', default: '1' } },
});
const skill = positionals[0] ?? 'roadmap-prioritization';
if (!SERVERS[skill])
  throw new Error(
    `Unknown or not yet runnable skill "${skill}". Runnable: ${Object.keys(SERVERS).join(', ')}`,
  );
const model = process.env.EVAL_MODEL;
if (!model)
  throw new Error('Set EVAL_MODEL (and EVAL_BASE_URL / EVAL_API_KEY if not using LM Studio on localhost).');
const llm = {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:1234/v1',
  apiKey: process.env.EVAL_API_KEY,
  model,
};

const skillDir = new URL(`skills/${skill}/`, root);
const skillText = readFileSync(new URL('SKILL.md', skillDir), 'utf8').replace(
  /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
  '',
);
const system = `${skillText}\n\n---\n\n${readFileSync(new URL('report-template.md', skillDir), 'utf8')}`;

const casesDir = new URL(`evals/${skill}/cases/`, root);
const cases = readdirSync(casesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, casesDir), 'utf8')))
  .filter((c) => !values.case || c.id === values.case);

const client = new Client({ name: 'productops-evals', version: '0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL(SERVERS[skill], root))],
    env: { PRODUCTOPS_LOG_LEVEL: 'silent' },
  }),
);

const runs = [];
try {
  for (let r = 0; r < Number(values.repeat); r++) {
    for (const c of cases) {
      process.stderr.write(`▶ ${c.id} (run ${r + 1}) … `);
      let run;
      try {
        run = await runAgent({ client, system, prompt: c.prompt, llm });
      } catch (err) {
        run = { answer: '', calls: [], usage: {}, ms: 0, error: String(err) };
      }
      const check = checkReport({
        skill,
        report: run.answer,
        prompt: c.prompt,
        calls: run.calls,
        expect: c.expect,
      });
      const passed = check.passed && !run.error;
      process.stderr.write(`${passed ? 'pass' : 'FAIL'} (${run.ms} ms)\n`);
      runs.push({ case: c.id, run: r + 1, passed, ...run, check });
    }
  }
} finally {
  await client.close();
}

const passed = runs.filter((r) => r.passed).length;
const summary = {
  skill,
  model,
  baseUrl: llm.baseUrl,
  at: new Date().toISOString(),
  passRate: runs.length ? passed / runs.length : 0,
  passed,
  total: runs.length,
  avgMs: Math.round(runs.reduce((s, r) => s + r.ms, 0) / Math.max(1, runs.length)),
  tokens: runs.reduce(
    (s, r) => ({
      prompt: s.prompt + (r.usage?.prompt_tokens ?? 0),
      completion: s.completion + (r.usage?.completion_tokens ?? 0),
    }),
    { prompt: 0, completion: 0 },
  ),
};
mkdirSync(new URL('evals/results/', root), { recursive: true });
const file = new URL(
  `evals/results/${skill}-${model.replace(/[^\w.-]+/g, '_')}-${summary.at.replace(/[:.]/g, '-')}.json`,
  root,
);
writeFileSync(file, JSON.stringify({ summary, runs }, null, 2) + '\n');

console.log(
  `\n${skill} on ${model}: ${passed}/${runs.length} passed, avg ${summary.avgMs} ms, tokens in/out ${summary.tokens.prompt}/${summary.tokens.completion}`,
);
for (const r of runs.filter((x) => !x.passed)) {
  const failed = r.check.checks
    .filter((c) => !c.passed)
    .map((c) => `${c.id}${c.details ? ` (${c.details})` : ''}`);
  console.log(`  ✗ ${r.case}: ${r.error ?? failed.join('; ')}`);
}
console.log(`Details: ${fileURLToPath(file)}`);
process.exitCode = passed === runs.length ? 0 : 1;
