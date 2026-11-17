import * as z from 'zod/v4';
import { Meta, type ToolOutcome } from '@productops/core';

/** Stage 1 smoke tool: proves the transport, schemas and runtime wiring end to end. */
export const PingInput = z.object({
  message: z.string().max(200).default('ping').describe('Text echoed back by the server.'),
});
export type PingInput = z.infer<typeof PingInput>;

export const PingOutput = z.object({
  pong: z.string(),
  server: z.object({ name: z.string(), version: z.string(), node: z.string() }),
  meta: Meta,
});

export function createPingHandler(server: { name: string; version: string }) {
  return async (
    input: PingInput,
  ): Promise<ToolOutcome<{ pong: string; server: z.infer<typeof PingOutput>['server'] }>> => ({
    data: { pong: input.message, server: { ...server, node: process.version } },
    summary: `pong: ${input.message}`,
  });
}
