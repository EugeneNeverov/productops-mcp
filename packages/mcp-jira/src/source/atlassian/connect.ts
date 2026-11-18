import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';
import { ToolFailure } from '@productops-mcp/core';
import {
  ATLASSIAN_MCP_URL,
  AtlassianOAuthProvider,
  FileCredentialStore,
  LOOPBACK_PORT,
  REDIRECT_URL,
} from './auth.js';
import type { McpCaller } from './upstream.js';

const CLIENT_INFO = { name: 'productops-jira', version: '0' };

/** Server mode: connect with stored credentials; never opens a browser. */
export function serverConnector(store: FileCredentialStore, url = ATLASSIAN_MCP_URL) {
  return async (): Promise<McpCaller> => {
    if (!store.hasTokens()) {
      throw new ToolFailure('AUTH_REQUIRED', 'Not signed in to Atlassian.', {
        hint: 'Run `productops-jira login` in a terminal, then retry.',
      });
    }
    const client = new Client(CLIENT_INFO);
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      authProvider: new AtlassianOAuthProvider(store),
    });
    try {
      await client.connect(transport);
    } catch (err) {
      if (err instanceof ToolFailure) throw err;
      if (err instanceof UnauthorizedError) {
        throw new ToolFailure('AUTH_EXPIRED', 'The Atlassian sign-in has expired or was revoked.', {
          hint: 'Run `productops-jira login` again.',
        });
      }
      throw new ToolFailure(
        'UPSTREAM_ERROR',
        `Cannot reach the Atlassian MCP server: ${(err as Error).message}`,
      );
    }
    return client;
  };
}

export interface LoginOptions {
  store: FileCredentialStore;
  openBrowser: (url: URL) => void;
  log: (line: string) => void;
  url?: string;
  timeoutMs?: number;
}

/**
 * Interactive sign-in (`productops-jira login`): dynamic client registration, PKCE, consent in the
 * browser, code returned to a loopback listener on 127.0.0.1. Then one harmless read verifies access.
 */
export async function login(opts: LoginOptions): Promise<{ sites: string[] }> {
  const url = opts.url ?? ATLASSIAN_MCP_URL;
  const provider = new AtlassianOAuthProvider(opts.store, (authUrl) => {
    opts.log('Opening your browser for Atlassian sign-in. If it does not open, visit:');
    opts.log(authUrl.toString());
    opts.openBrowser(authUrl);
  });
  const callback = waitForCode(provider, opts.timeoutMs ?? 300_000);
  callback.promise.catch(() => {});
  try {
    let client = new Client(CLIENT_INFO);
    let transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
    try {
      await client.connect(transport);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      const code = await callback.promise;
      await transport.finishAuth(code);
      client = new Client(CLIENT_INFO);
      transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
      await client.connect(transport);
    }
    const res = await client.callTool({ name: 'getAccessibleAtlassianResources', arguments: {} });
    await client.close();
    const text = Array.isArray(res.content)
      ? res.content.map((c) => ('text' in c ? c.text : '')).join('')
      : '';
    const sites = [...text.matchAll(/https:\/\/[a-z0-9-]+\.atlassian\.net/gi)].map((m) => m[0]);
    return { sites: [...new Set(sites)] };
  } finally {
    callback.close();
  }
}

function waitForCode(provider: AtlassianOAuthProvider, timeoutMs: number) {
  let close = () => {};
  const promise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT_URL);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = u.searchParams.get('error');
      const state = u.searchParams.get('state');
      const code = u.searchParams.get('code');
      const ok = !error && code && (!provider.expectedState() || state === provider.expectedState());
      res
        .writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' })
        .end(
          ok ? 'ProductOps: signed in to Atlassian. You can close this tab.' : 'ProductOps: sign-in failed.',
        );
      if (error) reject(new Error(`Atlassian sign-in failed: ${error}`));
      else if (!code) reject(new Error('Atlassian sign-in returned no code'));
      else if (!ok) reject(new Error('OAuth state mismatch; sign-in aborted'));
      else resolve(code);
    });
    server.on('error', reject);
    server.listen(LOOPBACK_PORT, '127.0.0.1');
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for the Atlassian sign-in (5 minutes)')),
      timeoutMs,
    );
    timer.unref();
    close = () => {
      clearTimeout(timer);
      server.close();
    };
  });
  return { promise, close: () => close() };
}
