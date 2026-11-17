#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer, loadDeps, SERVER_NAME, SERVER_VERSION } from './server.js';

const deps = loadDeps();
serveStdio(() => createServer(deps), {
  onerror: (error) => deps.logger.error('transport error', { error }),
});
deps.logger.info('server started', { server: SERVER_NAME, version: SERVER_VERSION, transport: 'stdio' });
