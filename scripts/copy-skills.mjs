#!/usr/bin/env node
// Copies each server's skill from skills/ into its package, so the skill ships on npm and the
// server can serve it as an MCP prompt. skills/ stays the single source; the copies are gitignored.
// Also copies every skill into plugin/skills (committed: the Claude plugin directory reads the
// plugin folder from git and does not follow symlinks; CI checks the copies are current), and the root LICENSE into every package, because npm only packs files inside the package.
import { cpSync, rmSync } from 'node:fs';

const map = { 'mcp-prioritization': ['roadmap-prioritization'], 'mcp-jira': ['sprint-health-audit'] };
for (const [pkg, skills] of Object.entries(map)) {
  for (const skill of skills) {
    const dest = new URL(`../packages/${pkg}/skills/${skill}/`, import.meta.url);
    rmSync(dest, { recursive: true, force: true });
    cpSync(new URL(`../skills/${skill}/`, import.meta.url), dest, { recursive: true });
  }
}

for (const pkg of ['core', 'mcp-prioritization', 'mcp-jira']) {
  cpSync(new URL('../LICENSE', import.meta.url), new URL(`../packages/${pkg}/LICENSE`, import.meta.url));
}

// The Claude plugin bundles both skills.
const pluginSkills = new URL('../plugin/skills/', import.meta.url);
rmSync(pluginSkills, { recursive: true, force: true });
for (const skill of Object.values(map).flat()) {
  cpSync(new URL(`../skills/${skill}/`, import.meta.url), new URL(`${skill}/`, pluginSkills), {
    recursive: true,
  });
}
