// FROZEN CONTRACT (Task 2). Changes need lead approval — see docs/progress/README.md.
// Amendment (user-approved 2026-11-14, T31): channel 'crew' for first officer callouts.
// Amendment (user-approved design 5.7, T44, 2026-11-17): end reason 'completed' for a flight that ends on reaching its goal.
import { z } from 'zod';
import { AircraftPatchSchema, CONTROL_VALUE_SCHEMAS, ControlIdSchema } from './aircraft';

export const ChannelSchema = z.enum(['atc', 'cabin', 'dispatch', 'ground', 'crew']);
export type Channel = z.infer<typeof ChannelSchema>;

export const ReasonCategorySchema = z.enum(['crm', 'automation', 'handling', 'procedures', 'systems']);
export type ReasonCategory = z.infer<typeof ReasonCategorySchema>;

/** Exact debrief labels (Global Constraints in the plan). Original wording. */
export const REASON_LABELS: Readonly<Record<ReasonCategory, string>> = Object.freeze({
  crm: 'Communication & CRM',
  automation: 'Automation',
  handling: 'Aircraft handling',
  procedures: 'Procedures',
  systems: 'Systems knowledge',
});

export const ReplyCardSchema = z.strictObject({ id: z.string().min(1), text: z.string().min(1) });
export type ReplyCard = z.infer<typeof ReplyCardSchema>;

export const EndReasonSchema = z.enum(['diversionSetUp', 'continueConfirmed', 'completed', 'timeout', 'instructorEnded']);
export type EndReason = z.infer<typeof EndReasonSchema>;

/** Everything the "world" can tell the pilot. Strict: unknown keys (e.g. instructor notes) are rejected. */
export const WorldCueSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message'),
    id: z.string().min(1),
    channel: ChannelSchema,
    text: z.string().min(1),
    audio: z.string().optional(),
    cards: z.array(ReplyCardSchema).optional(),
  }),
  z.strictObject({ kind: z.literal('printout'), id: z.string().min(1), title: z.string(), body: z.string() }),
  z.strictObject({
    kind: z.literal('alert'),
    id: z.string().min(1),
    level: z.enum(['warning', 'caution', 'advisory']),
    text: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('alertClear'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('aircraft'), patch: AircraftPatchSchema }),
  z.strictObject({ kind: z.literal('checklistAvailable'), checklistId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('eventSet'), eventSetId: z.string().min(1), status: z.enum(['start', 'end']) }),
  z.strictObject({ kind: z.literal('scenarioEnd'), reason: EndReasonSchema }),
]);
export type WorldCue = z.infer<typeof WorldCueSchema>;

/** Everything the pilot can do. Emitted by the cockpit, unstamped; the engine stamps it. */
export const PilotActionSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('control'), controlId: ControlIdSchema, value: z.union([z.number(), z.boolean(), z.string()]) })
    .superRefine((a, ctx) => {
      if (!CONTROL_VALUE_SCHEMAS[a.controlId].safeParse(a.value).success)
        ctx.addIssue({ code: 'custom', message: `invalid value for control '${a.controlId}'`, path: ['value'] });
    }),
  z.strictObject({ kind: z.literal('reply'), messageId: z.string().min(1), cardId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('checklistItem'), checklistId: z.string().min(1), itemId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('alertAck'), alertId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('hint'), eventSetId: z.string().min(1) }),
]);
export type PilotAction = z.infer<typeof PilotActionSchema>;

/** `t` = scenario seconds; `seq` = monotonically increasing per session. */
export interface Stamped<T> {
  t: number;
  seq: number;
  body: T;
}
export const stampedSchema = <T extends z.ZodType>(body: T) =>
  z.strictObject({ t: z.number(), seq: z.number().int(), body });

export const EventSetGradeSchema = z.strictObject({
  eventSetId: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reasons: z.array(z.strictObject({ category: ReasonCategorySchema, text: z.string() })).max(3),
  hintUsed: z.boolean(),
  source: z.enum(['auto', 'instructor']),
  comment: z.string().optional(),
});
export type EventSetGrade = z.infer<typeof EventSetGradeSchema>;

/**
 * Guard for anything about to be rendered in the headset. Returns the same object
 * when it is a valid pilot-visible cue; throws if it carries unknown fields
 * (e.g. `instructorNotes`, `instructorLabel`).
 */
export function pilotSafe(cue: WorldCue): WorldCue {
  WorldCueSchema.parse(cue);
  return cue;
}
