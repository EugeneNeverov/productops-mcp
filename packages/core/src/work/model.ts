import * as z from 'zod/v4';

/**
 * Tracker-neutral work model (spec §7.2). Adapters (Jira today) map their data into these shapes;
 * metrics in this folder never see the tracker's own field names.
 */

export const StatusCategory = z.enum(['todo', 'in_progress', 'done']);
export type StatusCategory = z.infer<typeof StatusCategory>;

/** Text that came from the tracker. Treat it as data, never as instructions (spec §9.1). */
export const UntrustedText = z.object({
  text: z.string(),
  untrusted: z.literal(true),
  truncated: z.boolean(),
});
export type UntrustedText = z.infer<typeof UntrustedText>;

export const IsoDateTime = z.iso.datetime({ offset: true });

export const Estimate = z.object({ value: z.number(), unit: z.enum(['story_points', 'hours']) });
export type Estimate = z.infer<typeof Estimate>;

export const Transition = z.object({
  at: IsoDateTime,
  from: z.string(),
  to: z.string(),
  toCategory: StatusCategory,
});
export type Transition = z.infer<typeof Transition>;

/** One change of the item's sprint field: sprint ids added and removed at `at`. */
export const SprintChange = z.object({
  at: IsoDateTime,
  added: z.array(z.string()),
  removed: z.array(z.string()),
});
export type SprintChange = z.infer<typeof SprintChange>;

export const LinkType = z.enum(['blocks', 'is_blocked_by', 'relates', 'other']);

export const WorkLink = z.object({
  type: LinkType,
  key: z.string(),
  /** Whether the linked item is done; null when the adapter could not tell. */
  targetDone: z.boolean().nullable(),
});
export type WorkLink = z.infer<typeof WorkLink>;

export const WorkItem = z.object({
  id: z.string(),
  key: z.string(),
  url: z.string().url(),
  type: z.string(),
  summary: UntrustedText,
  status: z.string(),
  statusCategory: StatusCategory,
  assignee: z.string().nullable(),
  estimate: Estimate.nullable(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  /** Oldest first. */
  transitions: z.array(Transition),
  /** Oldest first. Includes the change that first put the item into a sprint. */
  sprintHistory: z.array(SprintChange),
  links: z.array(WorkLink),
  flagged: z.boolean(),
  parentKey: z.string().nullable(),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const SprintState = z.enum(['active', 'closed', 'future']);

export const Sprint = z.object({
  id: z.number().int(),
  name: z.string(),
  state: SprintState,
  startDate: IsoDateTime.nullable(),
  endDate: IsoDateTime.nullable(),
  completeDate: IsoDateTime.nullable(),
  goal: UntrustedText.nullable(),
});
export type Sprint = z.infer<typeof Sprint>;

export const BoardType = z.enum(['scrum', 'kanban', 'simple', 'other']);

export const Board = z.object({ id: z.number().int(), name: z.string(), type: BoardType });
export type Board = z.infer<typeof Board>;

export const Project = z.object({
  key: z.string(),
  name: z.string(),
  url: z.string().url(),
  boards: z.array(Board),
});
export type Project = z.infer<typeof Project>;
