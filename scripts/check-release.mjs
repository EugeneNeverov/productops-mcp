#!/usr/bin/env node
// Checks that a release is consistent before anything is published:
// every package has the same version, server.json files carry it too (top level and npm package),
// each server's mcpName matches its server.json name, the Claude plugin pins this version, and, if a
// tag is given, it equals v<version>.
// Usage: node scripts/check-release.mjs [tag]
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const problems = [];
const versions = new Map();
for (const pkg of ['core', 'mcp-prioritization', 'mcp-jira']) {
  versions.set(pkg, read(`packages/${pkg}/package.json`).version);
}
const version = versions.get('core');
for (const [pkg, v] of versions)
  if (v !== version) problems.push(`${pkg}: version ${v}, core has ${version}`);

for (const pkg of ['mcp-prioritization', 'mcp-jira']) {
  const meta = read(`packages/${pkg}/package.json`);
  const server = read(`packages/${pkg}/server.json`);
  if (server.version !== version) problems.push(`${pkg}/server.json: version ${server.version}`);
  if (meta.mcpName !== server.name)
    problems.push(`${pkg}: mcpName ${meta.mcpName} != server.json name ${server.name}`);
  for (const p of server.packages) {
    if (p.identifier !== meta.name) problems.push(`${pkg}/server.json: identifier ${p.identifier}`);
    if (p.version !== version) problems.push(`${pkg}/server.json: package version ${p.version}`);
  }
  if (server.description.length > 100) problems.push(`${pkg}/server.json: description over 100 characters`);
}

// The Claude plugin pins the published server versions.
const plugin = read('plugin/.claude-plugin/plugin.json');
if (plugin.version !== version) problems.push(`plugin/.claude-plugin/plugin.json: version ${plugin.version}`);
const market = read('.claude-plugin/marketplace.json');
for (const p of market.plugins)
  if (p.version !== version) problems.push(`.claude-plugin/marketplace.json: ${p.name} version ${p.version}`);
const mcp = read('plugin/.mcp.json');
for (const [key, pkg] of [
  ['productops-prioritization', 'mcp-prioritization'],
  ['productops-jira', 'mcp-jira'],
]) {
  const want = `${read(`packages/${pkg}/package.json`).name}@${version}`;
  if (!mcp.mcpServers[key]?.args?.includes(want)) problems.push(`plugin/.mcp.json: ${key} must run ${want}`);
}

const tag = process.argv[2];
if (tag && tag !== `v${version}`) problems.push(`tag ${tag} does not match version ${version}`);

if (problems.length) {
  console.error(`Release check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Release check passed: ${version}${tag ? ` (${tag})` : ''}`);
