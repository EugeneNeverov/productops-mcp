#!/usr/bin/env node
import { exec } from 'node:child_process';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLogger, ToolFailure } from '@productops/core';
import { createServer, loadDeps, SERVER_NAME, SERVER_VERSION, type ServerDeps } from './server.js';
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

if (command === 'login' || command === 'logout' || command === 'status') {
  // CLI commands talk to the terminal; the MCP server below keeps stdout for JSON-RPC only.
  const store = new FileCredentialStore(defaultCredentialsPath());
  const say = (line: string) => process.stderr.write(line + '\n');
  if (command === 'logout') {
    store.clear();
    say(`Signed out: removed ${store.path}`);
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
    deps = loadDeps();
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
