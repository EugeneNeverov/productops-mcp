import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';

const SKILL_DIR = new URL('../skills/sprint-health-audit/', import.meta.url);

/** SKILL.md without its YAML frontmatter, plus the report template: the same text an Agent Skills client loads. */
export function loadSprintSkill(): { description: string; instructions: string } {
  const raw = readFileSync(new URL('SKILL.md', SKILL_DIR), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  const description = /^description:\s*(.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim() ?? '';
  const body = match ? raw.slice(match[0].length) : raw;
  const template = readFileSync(new URL('report-template.md', SKILL_DIR), 'utf8');
  return { description, instructions: `${body.trim()}\n\n---\n\n${template.trim()}\n` };
}

export const SprintPromptArgs = z.object({
  board: z.string().optional().describe('Board id or project key, if known'),
  sprint: z.string().optional().describe('"active" (default), "last_closed", or a sprint id'),
  question: z.string().optional().describe('What the user wants to know, e.g. "why are we behind"'),
});
export type SprintPromptArgs = z.infer<typeof SprintPromptArgs>;

export function sprintPromptText(skill: { instructions: string }, args: SprintPromptArgs): string {
  const task = [
    args.board ? `Board: ${args.board}` : 'Board: find it with list_projects.',
    `Sprint: ${args.sprint ?? 'active'}`,
    args.question
      ? `Question: ${args.question}`
      : 'Question: how healthy is this sprint and what should we do in the next 48 hours?',
  ].join('\n');
  return `${skill.instructions}\n---\n\n# Task\n\n${task}\n`;
}
