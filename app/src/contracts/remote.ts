// FROZEN CONTRACT (Task 2). Changes need lead approval — see docs/progress/README.md.
// Messages between the headset (pilot) and the instructor console (Manual mode only).
import { z } from 'zod';
import { EndReasonSchema, EventSetGradeSchema, PilotActionSchema, stampedSchema } from './events';

export const RemoteMsgSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hello'), role: z.enum(['pilot', 'instructor']) }),
  z.strictObject({ kind: z.literal('fireRule'), eventSetId: z.string().min(1), ruleId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('pilotAction'), action: stampedSchema(PilotActionSchema) }),
  /** Authoritative session status from the headset. Sent after every rule firing, Event Set change,
   *  grade change, pause/resume, end, and on (re)connect. */
  z.strictObject({
    kind: z.literal('progress'),
    eventSetId: z.string().min(1).nullable(),
    t: z.number(),
    run: z.enum(['idle', 'running', 'ended']),
    paused: z.boolean(),
    endReason: EndReasonSchema.optional(),
    firedRuleIds: z.array(z.string()),
    grades: z.array(EventSetGradeSchema),
  }),
  z.strictObject({
    kind: z.literal('gradeOverride'),
    eventSetId: z.string().min(1),
    grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    comment: z.string().max(500),
  }),
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume') }),
  z.strictObject({ kind: z.literal('endSession') }),
]);
export type RemoteMsg = z.infer<typeof RemoteMsgSchema>;

/** Validate anything received over the network before acting on it. Throws on malformed input. */
export function parseRemoteMsg(input: unknown): RemoteMsg {
  return RemoteMsgSchema.parse(input);
}

export interface RemoteTransport {
  connect(code: string, role: 'pilot' | 'instructor'): Promise<void>;
  send(msg: RemoteMsg): void;
  onMessage(cb: (msg: RemoteMsg) => void): () => void;
  onStatus(cb: (s: 'connected' | 'disconnected') => void): () => void;
  close(): void;
}
