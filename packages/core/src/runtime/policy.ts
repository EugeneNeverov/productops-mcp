import * as z from 'zod/v4';

/** Tool allow/deny lists from productops.config.json (spec §6.2). Globs support `*` only. */
export const ToolPolicyConfig = z.object({
  allow: z.array(z.string()).default(['*']),
  deny: z.array(z.string()).default([]),
});
export type ToolPolicyConfig = z.infer<typeof ToolPolicyConfig>;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export interface ToolPolicy {
  isAllowed(toolName: string): boolean;
}

export function createToolPolicy(config: Partial<ToolPolicyConfig> = {}): ToolPolicy {
  const parsed = ToolPolicyConfig.parse(config);
  const allow = parsed.allow.map(globToRegExp);
  const deny = parsed.deny.map(globToRegExp);
  return {
    isAllowed: (name) => allow.some((r) => r.test(name)) && !deny.some((r) => r.test(name)),
  };
}

export const allowAllPolicy: ToolPolicy = { isAllowed: () => true };
