#!/usr/bin/env node
// Builds Claude Desktop extensions (.mcpb) for both servers into ./release.
// Each bundle is the published package plus its production node_modules (pnpm deploy, hoisted so the
// archive holds real files, not symlinks), the manifest from packages/<pkg>/mcpb and the icon.
// Run after `pnpm build`. Usage: node scripts/build-mcpb.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}release`;
const stage = `${root}.mcpb-stage`;
const MCPB = '@anthropic-ai/mcpb@2.1.2';
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

mkdirSync(out, { recursive: true });
rmSync(stage, { recursive: true, force: true });
for (const pkg of ['mcp-prioritization', 'mcp-jira']) {
  const meta = JSON.parse(readFileSync(`${root}packages/${pkg}/package.json`, 'utf8'));
  const dir = `${stage}/${pkg}`;
  run('pnpm', ['--filter', meta.name, '--config.node-linker=hoisted', 'deploy', '--prod', '--legacy', dir]);
  const manifest = JSON.parse(readFileSync(`${root}packages/${pkg}/mcpb/manifest.json`, 'utf8'));
  manifest.version = meta.version;
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  cpSync(`${root}assets/icon.png`, `${dir}/icon.png`);
  run('npx', ['-y', MCPB, 'validate', `${dir}/manifest.json`]);
  run('npx', ['-y', MCPB, 'pack', dir, `${out}/${manifest.name}-${meta.version}.mcpb`]);
}
rmSync(stage, { recursive: true, force: true });
