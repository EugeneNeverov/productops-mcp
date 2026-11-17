#!/usr/bin/env node
// ProductOps MCP spike: Node MCP client -> Atlassian Rovo remote MCP server (read-only).
// Findings: docs/spikes/2026-11-17-atlassian-mcp.md. Dev tool, not part of any package.
//
// Usage:
//   node scripts/spike-atlassian-mcp.mjs inventory                  connect (OAuth if needed), record server info + tools/list
//   node scripts/spike-atlassian-mcp.mjs call <tool> '<json args>'  call ONE read-only tool, record latency/size/shape
//
// Everything local goes to ./.spike-atlassian/ (override with SPIKE_DIR); the folder is gitignored:
//   secrets/oauth.json  DCR client info, tokens, PKCE verifier (never printed) - delete after
//   raw/                raw responses, may contain real Jira data - delete after
//   inventory.json      tool metadata only;  calls.jsonl  redacted per-call metrics
// Console output is redacted: strings become <string, N chars> except for an allow-list of
// structural keys (ids, keys, types, status categories, dates).
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';
import { Buffer } from 'node:buffer';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const ENDPOINTS = [
  process.env.MCP_URL || 'https://mcp.atlassian.com/v2/mcp',
  'https://mcp.atlassian.com/v1/mcp',
];
const PORT = 33418;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const DIR = resolve(process.env.SPIKE_DIR || '.spike-atlassian');
const SECRETS = join(DIR, 'secrets', 'oauth.json');
const RAW = join(DIR, 'raw');
const INVENTORY = join(DIR, 'inventory.json');
const LOG = join(DIR, 'calls.jsonl'); // redacted metrics only
mkdirSync(join(DIR, 'secrets'), { recursive: true });
mkdirSync(RAW, { recursive: true });

// Operations that executeRead may run. executeRead itself is annotated read-only, but the
// operation `name` inside its arguments is what picks the operation, so allow-list it.
const EXECUTE_READ_OPS = new Set([
  'listJiraProjects',
  'listJiraBoards',
  'getJiraBoardConfig',
  'listJiraBoardSprints',
  'getJiraBoardSprintData',
  'getJiraBoardIssueData',
  'listJiraIssueChangelogs',
]);

// ---------- tiny secret store (never printed) ----------
const load = () => (existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {});
const store = (patch) => writeFileSync(SECRETS, JSON.stringify({ ...load(), ...patch }, null, 2));

let pendingState;
class LoopbackProvider {
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return {
      client_name: 'ProductOps MCP spike (local)',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client, PKCE only
    };
  }
  state() {
    pendingState = randomBytes(16).toString('hex');
    return pendingState;
  }
  clientInformation() {
    return load().client;
  }
  saveClientInformation(c) {
    store({ client: c });
  }
  tokens() {
    return load().tokens;
  }
  saveTokens(t) {
    store({ tokens: t });
  }
  saveCodeVerifier(v) {
    store({ verifier: v });
  }
  codeVerifier() {
    return load().verifier;
  }
  saveDiscoveryState(s) {
    store({ discovery: s });
  }
  discoveryState() {
    return load().discovery;
  }
  invalidateCredentials(scope) {
    const s = load();
    if (scope === 'all' || scope === 'client') delete s.client;
    if (scope === 'all' || scope === 'tokens') delete s.tokens;
    if (scope === 'all' || scope === 'verifier') delete s.verifier;
    if (scope === 'all' || scope === 'discovery') delete s.discovery;
    writeFileSync(SECRETS, JSON.stringify(s, null, 2));
  }
  redirectToAuthorization(url) {
    console.log('\n>>> Opening browser for Atlassian consent. Sign in and approve there. <<<\n');
    // The URL is not logged (it only carries state and the PKCE challenge, but keep output clean).
    const open =
      process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${open} "${url.toString()}"`);
  }
}

function waitForCallback() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/plain' })
        .end('ProductOps spike: authorization received, you can close this tab.');
      srv.close();
      if (u.searchParams.get('error'))
        reject(
          new Error(
            'OAuth error: ' +
              u.searchParams.get('error') +
              ' ' +
              (u.searchParams.get('error_description') || ''),
          ),
        );
      else if (pendingState && u.searchParams.get('state') !== pendingState)
        reject(new Error('OAuth state mismatch'));
      else resolvePromise(u.searchParams);
    });
    srv.listen(PORT, '127.0.0.1');
    setTimeout(() => {
      srv.close();
      reject(new Error('Timed out waiting for OAuth callback (5 min)'));
    }, 300_000).unref();
  });
}

async function connect() {
  const provider = new LoopbackProvider();
  let lastErr;
  for (const url of ENDPOINTS) {
    const t0 = Date.now();
    try {
      let transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
      let client = new Client({ name: 'productops-spike', version: '0.0.1' });
      const cb = waitForCallback();
      cb.catch(() => {});
      try {
        await client.connect(transport);
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) throw e;
        const params = await cb;
        await transport.finishAuth(params);
        console.log('OAuth: authorization code exchanged, tokens cached under SPIKE_DIR/secrets');
        transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
        client = new Client({ name: 'productops-spike', version: '0.0.1' });
        await client.connect(transport);
      }
      return { client, url, connectMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      console.error(`Endpoint ${url} failed: ${e?.constructor?.name}: ${e?.message}`);
    }
  }
  throw lastErr;
}

// ---------- redaction ----------
const KEEP =
  /^(id|cloudId|key|issueKey|type|issuetype|name_type|statusCategory|colorName|created|updated|resolutiondate|startDate|endDate|completeDate|state|total|maxResults|startAt|isLast|nextPageToken|self_type|field|fieldtype|fieldId|from|to|fromString_cat|scopes|boardId|originBoardId)$/;
function shape(v, k = '', depth = 0) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string') {
      if (KEEP.test(k) && v.length <= 64) return v;
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return `<date>`;
      return `<string, ${v.length} chars>`;
    }
    return v;
  }
  if (depth > 8) return '<...>';
  if (Array.isArray(v)) return v.length ? [`<array len=${v.length}>`, shape(v[0], k, depth + 1)] : [];
  return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, shape(vv, kk, depth + 1)]));
}
function parseContent(res) {
  // Tools return content[]; text items are often JSON. Return parsed JSON when possible.
  return (res.content || []).map((c) => {
    if (c.type !== 'text') return { type: c.type };
    try {
      return { type: 'text(json)', json: JSON.parse(c.text) };
    } catch {
      return { type: 'text', chars: c.text.length };
    }
  });
}

const READ_ONLY_NAME =
  /^(get|search|list|lookup|fetch|atlassianUserInfo|getAccessible|read|describe|discover)/i;
const WRITE_NAME =
  /(create|edit|update|transition|add|delete|remove|comment|move|assign|set|publish|post|link|upload|execute)/i;

function assertReadOnly(tool, name, args) {
  if (name === 'executeRead') {
    if (!EXECUTE_READ_OPS.has(args.name))
      throw new Error(`Refusing executeRead op "${args.name}" (not allow-listed)`);
    return;
  }
  const ro = tool.annotations?.readOnlyHint === true || (READ_ONLY_NAME.test(name) && !WRITE_NAME.test(name));
  if (!ro || tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true)
    throw new Error(`Refusing non-read-only tool ${name}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== 'inventory' && cmd !== 'call') {
  console.error("Usage: spike-atlassian-mcp.mjs inventory | call <tool> '<json args>'");
  process.exit(2);
}
const { client, url, connectMs } = await connect();

if (cmd === 'inventory') {
  const info = {
    endpoint: url,
    connectMs,
    server: client.getServerVersion(),
    capabilities: client.getServerCapabilities(),
    instructions: client.getInstructions?.(),
  };
  const t0 = Date.now();
  const tools = [];
  let cursor;
  do {
    const r = await client.listTools(cursor ? { cursor } : {});
    tools.push(...r.tools);
    cursor = r.nextCursor;
  } while (cursor);
  info.listToolsMs = Date.now() - t0;
  info.tools = tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: (t.description || '').slice(0, 200),
    annotations: t.annotations,
    inputSchema: t.inputSchema,
    hasOutputSchema: !!t.outputSchema,
  }));
  writeFileSync(INVENTORY, JSON.stringify(info, null, 2)); // tool metadata only, no Jira data
  console.log(
    JSON.stringify(
      {
        endpoint: url,
        connectMs,
        listToolsMs: info.listToolsMs,
        server: info.server,
        capabilities: info.capabilities,
        toolCount: tools.length,
        instructionsChars: info.instructions?.length,
      },
      null,
      2,
    ),
  );
  console.log(
    tools
      .map((t) => `${t.name}  ro=${t.annotations?.readOnlyHint} destr=${t.annotations?.destructiveHint}`)
      .join('\n'),
  );
} else {
  const [name, argJson = '{}'] = rest;
  const inv = JSON.parse(readFileSync(INVENTORY, 'utf8'));
  const tool = inv.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const args = JSON.parse(argJson);
  assertReadOnly(tool, name, args);
  const t0 = Date.now();
  let res, err;
  try {
    res = await client.callTool({ name, arguments: args });
  } catch (e) {
    err = e;
  }
  const ms = Date.now() - t0;
  const body = JSON.stringify(res ?? { error: String(err?.message) });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(RAW, `${stamp}-${name}.json`), body); // raw, gitignored, local only
  const entry = {
    at: new Date().toISOString(),
    tool: name,
    argKeys: Object.keys(args),
    latencyMs: ms,
    bytes: Buffer.byteLength(body),
    isError: res?.isError ?? !!err,
    error: err ? `${err.constructor?.name}: ${err.message}`.slice(0, 500) : undefined,
    meta: res?._meta,
    structured: !!res?.structuredContent,
  };
  appendFileSync(LOG, JSON.stringify(entry) + '\n');
  console.log(JSON.stringify(entry, null, 2));
  console.log(
    'SHAPE:',
    JSON.stringify(shape(res?.structuredContent ?? parseContent(res ?? {})), null, 1).slice(0, 6000),
  );
  console.log('RAW:', join(RAW, `${stamp}-${name}.json`));
}
await client.close();
process.exit(0);
