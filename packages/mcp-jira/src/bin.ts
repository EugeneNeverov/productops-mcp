#!/usr/bin/env node
import { exec } from 'node:child_process';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLogger, ToolFailure } from '@productops-mcp/core';
import {
  createServer,
  defaultStorePath,
  loadDeps,
  SERVER_NAME,
  SERVER_VERSION,
  type ServerDeps,
} from './server.js';
import { auditCsv, openStore } from './store/store.js';
import { defaultCredentialsPath, FileCredentialStore } from './source/atlassian/auth.js';
import { login } from './source/atlassian/connect.js';

const command = process.argv[2];

function openBrowser(url: URL) {
  const target = JSON.stringify(url.toString());
  const cmd =
    process.platform === 'win32'
      ? `start "" ${target}`
      : process.platform === 'darwin'
        ? `open ${target}`
        : `xdg-open ${target}`;
  exec(cmd, () => {});
}

if (command === 'cache' || command === 'audit') {
  const sub = process.argv[3];
  const store = await openStore(defaultStorePath(), { retentionDays: 365 });
  if (store.kind === 'none') {
    process.stderr.write('The cache and audit log need Node 22.13 or newer (node:sqlite).\n');
    process.exitCode = 1;
  } else if (command === 'cache' && sub === 'clear') {
    process.stderr.write(`Removed ${store.cacheClear()} cached response(s).\n`);
  } else if (command === 'audit' && sub === 'export') {
    process.stdout.write(auditCsv(store.auditRows()));
  } else {
    process.stderr.write('Usage: productops-jira cache clear | audit export\n');
    process.exitCode = 2;
  }
  store.close();
} else if (command === 'login' || command === 'logout' || command === 'status') {
  // CLI commands talk to the terminal; the MCP server below keeps stdout for JSON-RPC only.
  const store = new FileCredentialStore(defaultCredentialsPath());
  const say = (line: string) => process.stderr.write(line + '\n');
  if (command === 'logout') {
    store.clear();
    const db = await openStore(defaultStorePath(), { retentionDays: 365 });
    const removed = db.cacheClear();
    db.close();
    say(`Signed out: removed ${store.path}${removed ? ` and ${removed} cached response(s)` : ''}.`);
  } else if (command === 'status') {
    say(
      store.hasTokens()
        ? `Signed in (credentials in ${store.path}).`
        : 'Not signed in. Run `productops-jira login`.',
    );
  } else {
    try {
      const { sites } = await login({ store, openBrowser, log: say });
      say(`Signed in. Credentials saved to ${store.path} (readable only by you).`);
      if (sites.length) say(`Jira sites you can read: ${sites.join(', ')}`);
      say('Start the server with PRODUCTOPS_JIRA_MODE=live.');
    } catch (err) {
      say(`Sign-in failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
} else {
  let deps: ServerDeps;
  try {
    deps = await loadDeps();
  } catch (err) {
    const log = createLogger({ name: SERVER_NAME });
    log.error(err instanceof ToolFailure ? err.message : 'Failed to start', {
      ...(err instanceof ToolFailure ? { details: err.details } : { error: err }),
    });
    process.exit(1);
  }
  serveStdio(() => createServer(deps), {
    onerror: (error) => deps.logger.error('transport error', { error }),
  });
  deps.logger.info('server started', {
    server: SERVER_NAME,
    version: SERVER_VERSION,
    transport: 'stdio',
    mode: deps.source.mode,
  });
}
