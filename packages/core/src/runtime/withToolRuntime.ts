import { ToolFailure, type ToolError } from '../schemas/errors.js';
import type { Meta, SourceInfo, Warning } from '../schemas/meta.js';
import { inputHash } from './hash.js';
import type { Logger } from './logger.js';
import { allowAllPolicy, type ToolPolicy } from './policy.js';

/** Structural subset of the MCP CallToolResult, so core stays independent of the SDK. */
export interface ToolCallResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolContext {
  /** Adds a soft problem to `meta.warnings` (spec §4: warnings are not errors). */
  warn(warning: Warning): void;
  /** Aborted when the tool exceeds its timeout. */
  signal: AbortSignal;
}

export interface ToolOutcome<T extends Record<string, unknown>> {
  data: T;
  /** Short human-readable summary for clients that ignore structuredContent (≤ 1500 chars). */
  summary: string;
  /** Where the data came from, for tools that read an external system. */
  source?: SourceInfo;
}

export interface RuntimeDeps {
  version: string;
  logger: Logger;
  policy?: ToolPolicy;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface ToolRuntimeOptions {
  timeoutMs?: number;
}

export const SUMMARY_MAX_CHARS = 1500;
export const INLINE_JSON_MAX_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Wraps a tool handler with the behaviour every ProductOps tool shares: policy check,
 * timeout, meta block, text + structured content, and translation of exceptions into ToolError.
 */
export function withToolRuntime<I, T extends Record<string, unknown>>(
  toolName: string,
  deps: RuntimeDeps,
  handler: (input: I, ctx: ToolContext) => Promise<ToolOutcome<T>>,
  options: ToolRuntimeOptions = {},
): (input: I) => Promise<ToolCallResult> {
  const policy = deps.policy ?? allowAllPolicy;
  const now = deps.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (input: I) => {
    const started = Date.now();
    const computedAt = now().toISOString();
    const errorMeta = { tool: toolName, version: deps.version, computedAt };

    if (!policy.isAllowed(toolName)) {
      deps.logger.warn('tool denied by policy', { tool: toolName });
      return errorResult(
        new ToolFailure('PERMISSION_DENIED', `Tool "${toolName}" is disabled by the server configuration.`, {
          hint: 'Check tools.allow / tools.deny in productops.config.json.',
        }),
        errorMeta,
      );
    }

    const warnings: Warning[] = [];
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject first so a handler that settles on abort cannot win the race.
        reject(new ToolFailure('TIMEOUT', `Tool "${toolName}" did not finish within ${timeoutMs} ms.`));
        controller.abort();
      }, timeoutMs);
    });

    try {
      const outcome = await Promise.race([
        handler(input, { warn: (w) => warnings.push(w), signal: controller.signal }),
        timeout,
      ]);
      const meta: Meta = {
        tool: toolName,
        version: deps.version,
        computedAt,
        inputHash: inputHash(input),
        warnings,
        ...(outcome.source ? { source: outcome.source } : {}),
      };
      const structured = { ...outcome.data, meta };
      deps.logger.info('tool ok', {
        tool: toolName,
        durationMs: Date.now() - started,
        warnings: warnings.length,
      });
      return {
        content: [{ type: 'text', text: renderText(outcome.summary, structured) }],
        structuredContent: structured,
      };
    } catch (err) {
      const failure = err instanceof ToolFailure ? err : undefined;
      deps.logger[failure ? 'warn' : 'error']('tool failed', {
        tool: toolName,
        durationMs: Date.now() - started,
        code: failure?.code ?? 'INTERNAL',
        ...(failure ? {} : { error: err }),
      });
      return errorResult(
        failure ??
          new ToolFailure('INTERNAL', `Tool "${toolName}" failed unexpectedly.`, {
            hint: 'Server logs (stderr) contain the details.',
          }),
        errorMeta,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

function renderText(summary: string, structured: Record<string, unknown>): string {
  const head = summary.length > SUMMARY_MAX_CHARS ? summary.slice(0, SUMMARY_MAX_CHARS - 1) + '…' : summary;
  const json = JSON.stringify(structured);
  return Buffer.byteLength(json, 'utf8') <= INLINE_JSON_MAX_BYTES ? `${head}\n\n${json}` : head;
}

function errorResult(failure: ToolFailure, meta: ToolError['meta']): ToolCallResult {
  const body: ToolError = { error: failure.toBody(), meta };
  const hint = failure.hint ? `\nHint: ${failure.hint}` : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `${failure.code}: ${failure.message}${hint}` }],
    structuredContent: body,
  };
}
