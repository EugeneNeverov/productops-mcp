import { ToolFailure } from '@productops/core';

/**
 * The slice of the Atlassian Rovo MCP server this package uses (docs/spikes/2026-11-17-atlassian-mcp.md).
 * Everything is read-only: write tools are never called, and executeRead only runs allow-listed ops.
 */
export const DIRECT_TOOLS = new Set([
  'getAccessibleAtlassianResources',
  'searchJiraIssuesUsingJql',
  'executeRead',
]);
export const EXECUTE_READ_OPS = new Set([
  'listJiraProjects',
  'listJiraBoards',
  'listJiraBoardSprints',
  'getJiraBoardSprintData',
  'listJiraIssueChangelogs',
]);

/** Minimal client surface, so tests can inject an in-memory fake of the Atlassian server. */
export interface McpCaller {
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content?: unknown;
    structuredContent?: unknown;
  }>;
}

export class Upstream {
  constructor(private readonly connect: () => Promise<McpCaller>) {}
  private client: Promise<McpCaller> | undefined;

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!DIRECT_TOOLS.has(name)) throw new Error(`Upstream tool ${name} is not allowed`);
    if (name === 'executeRead' && !EXECUTE_READ_OPS.has(String(args.name))) {
      throw new Error(`executeRead op ${String(args.name)} is not allowed`);
    }
    this.client ??= this.connect().catch((err) => {
      this.client = undefined;
      throw err;
    });
    const client = await this.client;
    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (err) {
      throw toFailure(err, name);
    }
    const text = textOf(result.content);
    if (result.isError) throw failureFromText(text, name);
    if (result.structuredContent !== undefined) return unwrap(result.structuredContent);
    return unwrap(parseJsonPrefix(text, name));
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } => (c as { type?: string })?.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/** Results are JSON in a text item; `discover` appends plain text after the JSON, so parse the first value. */
export function parseJsonPrefix(text: string, tool: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Find the end of the first top-level JSON value.
    let depth = 0;
    let inString = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(0, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new ToolFailure('UPSTREAM_ERROR', `Atlassian MCP tool ${tool} returned an unreadable response.`, {
    retryable: false,
  });
}

/** Many results are wrapped as `{ data: ... }`. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'data' in v && Object.keys(v).length <= 2) {
    return (v as { data: unknown }).data;
  }
  return v;
}

export function failureFromText(text: string, tool: string): ToolFailure {
  const short = text.replace(/\s+/g, ' ').slice(0, 300);
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) {
    return new ToolFailure('RATE_LIMITED', `Atlassian rate limit reached (${tool}).`, {
      hint: 'Wait a few minutes and retry; repeated calls also spend Rovo credits.',
    });
  }
  if (/credit|quota|usage limit/i.test(text)) {
    return new ToolFailure('RATE_LIMITED', `Atlassian usage limit reached (${tool}): ${short}`, {
      hint: 'Rovo credits may be exhausted for this month; check admin.atlassian.com → Rovo usage.',
    });
  }
  if (/\b401\b|unauthori[sz]ed|invalid.?token|expired/i.test(text)) {
    return new ToolFailure('AUTH_EXPIRED', 'The Atlassian sign-in has expired.', {
      hint: 'Run `productops-jira login` again.',
    });
  }
  if (/\b403\b|forbidden|permission|scope/i.test(text)) {
    return new ToolFailure('INSUFFICIENT_SCOPE', `Atlassian denied access (${tool}): ${short}`, {
      hint: 'Check that your Atlassian account can browse this project.',
    });
  }
  if (/\b404\b|not found|does not exist/i.test(text)) {
    return new ToolFailure('NOT_FOUND', `Not found in Jira (${tool}): ${short}`);
  }
  return new ToolFailure('UPSTREAM_ERROR', `Atlassian MCP tool ${tool} failed: ${short}`);
}

function toFailure(err: unknown, tool: string): ToolFailure {
  if (err instanceof ToolFailure) return err;
  const name = (err as Error)?.constructor?.name ?? '';
  const message = (err as Error)?.message ?? String(err);
  if (name === 'UnauthorizedError' || /unauthori[sz]ed|invalid_grant/i.test(message)) {
    return new ToolFailure('AUTH_EXPIRED', 'The Atlassian sign-in has expired or was revoked.', {
      hint: 'Run `productops-jira login` again.',
    });
  }
  return failureFromText(message, tool);
}
