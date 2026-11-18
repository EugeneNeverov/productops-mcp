import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from '@modelcontextprotocol/client';
import { ToolFailure } from '@productops-mcp/core';

export const ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v2/mcp';
export const LOOPBACK_PORT = 33418;
export const REDIRECT_URL = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  discovery?: unknown;
  savedAt?: string;
}

export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.PRODUCTOPS_HOME || join(homedir(), '.productops');
  return join(home, 'atlassian-oauth.json');
}

/**
 * OAuth state on disk, readable only by the user (0600), written atomically (temp file + rename),
 * so a rotated refresh token is never half-written (spec §9.2). The access token lives here too,
 * because the SDK refreshes it; nothing from this file is ever logged or returned by a tool.
 * An OS keychain store is a planned follow-up.
 */
export class FileCredentialStore {
  constructor(readonly path: string) {}

  read(): Stored {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Stored;
    } catch {
      return {};
    }
  }

  update(patch: Partial<Stored>): void {
    const next = { ...this.read(), ...patch, savedAt: new Date().toISOString() };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Windows ignores POSIX modes; the file sits in the user's profile.
    }
  }

  remove(keys: (keyof Stored)[]): void {
    const s = this.read();
    for (const k of keys) delete s[k];
    if (Object.keys(s).filter((k) => k !== 'savedAt').length === 0) this.clear();
    else this.update(s);
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }

  hasTokens(): boolean {
    return Boolean(this.read().tokens?.refresh_token || this.read().tokens?.access_token);
  }
}

const CLIENT_METADATA: OAuthClientMetadata = {
  client_name: 'ProductOps Jira MCP (local)',
  redirect_uris: [REDIRECT_URL],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none', // public client: PKCE, no secret
};

/**
 * OAuth provider for the SDK: dynamic client registration as a public client, PKCE S256,
 * loopback redirect. In server mode `onAuthorize` is unset, so a missing or revoked grant fails
 * with AUTH_EXPIRED instead of opening a browser from inside an MCP server.
 */
export class AtlassianOAuthProvider implements OAuthClientProvider {
  private pendingState: string | undefined;

  constructor(
    private readonly store: FileCredentialStore,
    private readonly onAuthorize?: (url: URL) => void | Promise<void>,
  ) {}

  get redirectUrl() {
    return REDIRECT_URL;
  }
  get clientMetadata() {
    return CLIENT_METADATA;
  }
  state() {
    this.pendingState = randomBytes(16).toString('hex');
    return this.pendingState;
  }
  expectedState() {
    return this.pendingState;
  }
  clientInformation() {
    return this.store.read().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.store.update({ client });
  }
  tokens() {
    return this.store.read().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.store.update({ tokens });
  }
  saveCodeVerifier(verifier: string) {
    this.store.update({ verifier });
  }
  codeVerifier() {
    const v = this.store.read().verifier;
    if (!v) throw new Error('No PKCE code verifier saved');
    return v;
  }
  saveDiscoveryState(discovery: unknown) {
    this.store.update({ discovery });
  }
  discoveryState() {
    return this.store.read().discovery as never;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.store.clear();
    else this.store.remove([scope === 'tokens' ? 'tokens' : scope]);
  }
  async redirectToAuthorization(url: URL) {
    if (!this.onAuthorize) {
      throw new ToolFailure('AUTH_EXPIRED', 'Not signed in to Atlassian, or the sign-in has expired.', {
        hint: 'Run `productops-jira login` in a terminal, then retry.',
      });
    }
    await this.onAuthorize(url);
  }
}
