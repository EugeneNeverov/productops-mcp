import * as z from 'zod/v4';
import {
  InitiativesSource,
  Meta,
  simulateCapacity,
  ToolFailure,
  type ToolContext,
} from '@productops-mcp/core';
import { CustomInput, load, type ToolEnv } from './common.js';

const ScenarioInput = z.object({
  name: z.string().min(1).max(40),
  capacityMultiplier: z.number().min(0).max(3).default(1).describe('0.8 = 20% fewer people'),
  effortMultiplier: z.number().min(0.1).max(5).default(1).describe('1.3 = estimates are 30% too low'),
  forceInclude: z.array(z.string()).default([]),
  forceExclude: z.array(z.string()).default([]),
});

export const SimulateCapacityInput = z.object({
  initiatives: InitiativesSource,
  rankBy: z.enum(['RICE', 'WSJF', 'CUSTOM', 'INPUT_ORDER']).default('RICE'),
  custom: CustomInput.optional(),
  capacity: z
    .array(
      z.object({
        team: z.string().default('*').describe('Team name, or "*" for a shared pool'),
        amount: z.number().nonnegative().describe('Same unit as initiative effort'),
      }),
    )
    .min(1),
  scenarios: z
    .array(ScenarioInput)
    .min(1)
    .max(5)
    .default([
      { name: 'base', capacityMultiplier: 1, effortMultiplier: 1, forceInclude: [], forceExclude: [] },
    ]),
  respectDependencies: z.boolean().default(true),
});
export type SimulateCapacityInput = z.infer<typeof SimulateCapacityInput>;

export const SimulateCapacityOutput = z.object({
  rankBy: z.string(),
  scenarios: z.array(
    z.object({
      name: z.string(),
      includedCount: z.number().int(),
      deferredCount: z.number().int(),
      included: z.array(
        z.object({
          id: z.string(),
          rank: z.number().int(),
          effort: z.number(),
          team: z.string(),
          via: z.enum(['MANDATORY', 'FORCED', 'RANK', 'DEPENDENCY']),
        }),
      ),
      deferred: z.array(
        z.object({
          id: z.string(),
          rank: z.number().int(),
          reason: z.enum(['CAPACITY', 'DEPENDENCY', 'FORCED_OUT']),
          blockedBy: z.array(z.string()).optional(),
        }),
      ),
      utilization: z.record(
        z.string(),
        z.object({ used: z.number(), capacity: z.number(), pct: z.number().nullable() }),
      ),
      totalScoreIncluded: z.number().nullable(),
      overCommitted: z.boolean(),
    }),
  ),
  diffVsFirst: z.array(
    z.object({ scenario: z.string(), added: z.array(z.string()), removed: z.array(z.string()) }),
  ),
  meta: Meta,
});

export const capacityDescription =
  'Fit ranked initiatives into team capacity and compare up to 5 what-if scenarios (fewer people, ' +
  'underestimated effort, forced in/out). Greedy by rank: mandatory items first, dependencies pulled in ' +
  'together, every deferred item gets a reason.';

export function createCapacityHandler(env: ToolEnv) {
  return async (input: SimulateCapacityInput, ctx: ToolContext) => {
    if (input.rankBy === 'CUSTOM' && !input.custom) {
      throw new ToolFailure('VALIDATION_ERROR', 'rankBy CUSTOM requires the "custom" weights object.');
    }
    const names = input.scenarios.map((s) => s.name);
    if (new Set(names).size !== names.length)
      throw new ToolFailure('VALIDATION_ERROR', 'Scenario names must be unique.');
    const items = load(env, input.initiatives, ctx);
    const result = simulateCapacity({
      items,
      rankBy: input.rankBy,
      ...(input.custom ? { custom: input.custom } : {}),
      capacity: input.capacity,
      scenarios: input.scenarios,
      respectDependencies: input.respectDependencies,
      warn: ctx.warn,
    });
    const lines = result.scenarios.map(
      (s) =>
        `${s.name}: ${s.included.length} in, ${s.deferred.length} deferred${s.overCommitted ? ' (OVER-COMMITTED)' : ''}`,
    );
    return { data: { rankBy: input.rankBy, ...result }, summary: lines.join('\n') };
  };
}
