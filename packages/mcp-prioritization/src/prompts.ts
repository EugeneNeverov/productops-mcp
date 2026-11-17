import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';

const SKILL_DIR = new URL('../skills/roadmap-prioritization/', import.meta.url);

/** SKILL.md without its YAML frontmatter, plus the report template: the same text an Agent Skills client loads. */
export function loadRoadmapSkill(): { description: string; instructions: string } {
  const raw = readFileSync(new URL('SKILL.md', SKILL_DIR), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  const description = /^description:\s*(.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim() ?? '';
  const body = match ? raw.slice(match[0].length) : raw;
  const template = readFileSync(new URL('report-template.md', SKILL_DIR), 'utf8');
  return { description, instructions: `${body.trim()}\n\n---\n\n${template.trim()}\n` };
}

export const RoadmapPromptArgs = z.object({
  source: z
    .string()
    .optional()
    .describe(
      'Where the initiatives are: "demo", a file path inside the allowed folder, or "inline" if pasted',
    ),
  capacity: z
    .string()
    .optional()
    .describe('Capacity per team, e.g. "Growth 10, Platform 12, Mobile 12 person-months"'),
  question: z
    .string()
    .optional()
    .describe('What the user wants to decide, e.g. "what fits in Q1 with 20% fewer people"'),
});
export type RoadmapPromptArgs = z.infer<typeof RoadmapPromptArgs>;

export function roadmapPromptText(skill: { instructions: string }, args: RoadmapPromptArgs): string {
  const task = [
    args.source ? `Initiatives: ${args.source}` : 'Initiatives: ask me where they are.',
    args.capacity ? `Capacity: ${args.capacity}` : 'Capacity: ask me if it is needed.',
    args.question ? `Question: ${args.question}` : 'Question: build a prioritized plan with trade-offs.',
  ].join('\n');
  return `${skill.instructions}\n---\n\n# Task\n\n${task}\n`;
}
