import * as z from 'zod/v4';

/** RICE impact scale (Intercom): minimal, low, medium, high, massive. */
export const IMPACT_SCALE = [0.25, 0.5, 1, 2, 3] as const;
/** Modified Fibonacci scale used by SAFe WSJF. */
export const FIB_SCALE = [1, 2, 3, 5, 8, 13, 20] as const;

export const Impact = z.literal(IMPACT_SCALE);
export const Fib = z.literal(FIB_SCALE);

export const MAX_INITIATIVES = 500;

export const Initiative = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'id may contain only letters, digits, ".", "_" and "-"'),
  title: z.string().min(1).max(200),
  team: z.string().max(64).optional(),
  tags: z.array(z.string().max(32)).max(20).default([]),
  // RICE
  reach: z.number().nonnegative().optional().describe('People or events per period'),
  impact: Impact.optional().describe('0.25 minimal, 0.5 low, 1 medium, 2 high, 3 massive'),
  confidence: z.number().min(0).max(1).optional().describe('0..1, e.g. 0.8 = 80%'),
  effort: z.number().positive().optional().describe('Person-months by default; also used for capacity'),
  // WSJF
  businessValue: Fib.optional(),
  timeCriticality: Fib.optional(),
  riskReductionOpportunity: Fib.optional(),
  jobSize: Fib.optional(),
  // Planning
  dependsOn: z.array(z.string()).max(50).default([]),
  mandatory: z.boolean().default(false),
  earliestStart: z.iso.date().optional(),
  deadline: z.iso.date().optional(),
});
export type Initiative = z.infer<typeof Initiative>;

export const InitiativesSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), items: z.array(Initiative).min(1).max(MAX_INITIATIVES) }),
  z.object({
    kind: z.literal('file'),
    path: z.string().min(1).max(1024).describe('Path inside one of the configured allowedRoots'),
    format: z.enum(['csv', 'json']).optional().describe('Defaults to the file extension'),
  }),
  z.object({
    kind: z.literal('demo'),
    name: z.enum(['saas-roadmap']).default('saas-roadmap').describe('Bundled synthetic dataset'),
  }),
]);
export type InitiativesSource = z.infer<typeof InitiativesSource>;

export const Method = z.enum(['RICE', 'WSJF']);
export type Method = z.infer<typeof Method>;
