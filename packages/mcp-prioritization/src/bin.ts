#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLogger, ToolFailure } from '@productops/core';
import { createServer, loadDeps, SERVER_NAME, SERVER_VERSION, type ServerDeps } from './server.js';

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
deps.logger.info('server started', { server: SERVER_NAME, version: SERVER_VERSION, transport: 'stdio' });
