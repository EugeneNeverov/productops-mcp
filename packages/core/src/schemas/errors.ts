import * as z from 'zod/v4';

/** Error codes shared by every ProductOps tool (spec §4). */
export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'INPUT_TOO_LARGE',
  'FILE_NOT_ALLOWED',
  'FILE_PARSE_ERROR',
  'NOT_FOUND',
  'AUTH_REQUIRED',
  'AUTH_EXPIRED',
  'INSUFFICIENT_SCOPE',
  'RATE_LIMITED',
  'QUOTA_BUDGET_EXCEEDED',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'PERMISSION_DENIED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ToolErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  hint: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolErrorBody = z.infer<typeof ToolErrorBody>;

export const ToolError = z.object({
  error: ToolErrorBody,
  meta: z.object({ tool: z.string(), version: z.string(), computedAt: z.string().datetime() }),
});
export type ToolError = z.infer<typeof ToolError>;

const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorCode> = new Set(['RATE_LIMITED', 'UPSTREAM_ERROR', 'TIMEOUT']);

/**
 * Throw this from a tool handler to return a structured, user-facing error.
 * Any other thrown value is reported as INTERNAL with a generic message.
 */
export class ToolFailure extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly hint: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; hint?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'ToolFailure';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(code);
    this.hint = options.hint;
    this.details = options.details;
  }

  toBody(): ToolErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.hint !== undefined ? { hint: this.hint } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}
