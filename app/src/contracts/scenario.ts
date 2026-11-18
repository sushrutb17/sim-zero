// FROZEN CONTRACT (Task 2). Changes need lead approval — see docs/progress/README.md.
// Amendment (user-approved 2026-11-13, T24): optional `guide` on an Event Set (GuideStepSchema).
// Amendment (user-approved design 5.7, T44, 2026-11-17): `endConditions[].reason` may be 'completed'.
import { z } from 'zod';
import { AIRCRAFT_LEAVES, AircraftStateSchema, CONTROL_VALUE_SCHEMAS, ControlIdSchema } from './aircraft';
import { ReasonCategorySchema, WorldCueSchema, type WorldCue } from './events';

export { pilotSafe } from './events';

// ---------------------------------------------------------------------------
// Action matches: strict, per action kind; every field except `kind` optional.
// A match is satisfied when every given field equals the action's field.
// ---------------------------------------------------------------------------
export const ActionMatchSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('control'),
      controlId: ControlIdSchema.optional(),
      value: z.union([z.number(), z.boolean(), z.string()]).optional(),
    })
    .superRefine((m, ctx) => {
      if (m.controlId && m.value !== undefined && !CONTROL_VALUE_SCHEMAS[m.controlId].safeParse(m.value).success)
        ctx.addIssue({ code: 'custom', message: `invalid value for control '${m.controlId}'`, path: ['value'] });
    }),
  z.strictObject({ kind: z.literal('reply'), messageId: z.string().min(1).optional(), cardId: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('checklistItem'), checklistId: z.string().min(1).optional(), itemId: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('alertAck'), alertId: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('hint'), eventSetId: z.string().min(1).optional() }),
]);
export type ActionMatch = z.infer<typeof ActionMatchSchema>;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------
export type StateCondition = {
  kind: 'state';
  path: string;
  op: 'eq' | 'neq' | 'gte' | 'lte';
  value: number | string | boolean;
};
export type Condition =
  | { kind: 'atSec'; sec: number } // seconds since the current Event Set started
  | { kind: 'action'; match: ActionMatch }
  | StateCondition
  | { kind: 'ruleFired'; ruleId: string; afterSec?: number }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] };

const StateConditionSchema = z
  .strictObject({
    kind: z.literal('state'),
    path: z.string(),
    op: z.enum(['eq', 'neq', 'gte', 'lte']),
    value: z.union([z.number(), z.string(), z.boolean()]),
  })
  .superRefine((c, ctx) => {
    const leaf = AIRCRAFT_LEAVES.get(c.path);
    if (!leaf) return ctx.addIssue({ code: 'custom', message: `unknown aircraft state path '${c.path}'`, path: ['path'] });
    if (!leaf.safeParse(c.value).success)
      ctx.addIssue({ code: 'custom', message: `value ${JSON.stringify(c.value)} has the wrong type for '${c.path}'`, path: ['value'] });
    if ((c.op === 'gte' || c.op === 'lte') && (typeof c.value !== 'number' || !leaf.safeParse(0).success))
      ctx.addIssue({ code: 'custom', message: `'${c.op}' needs a numeric path and value ('${c.path}')`, path: ['op'] });
  });

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('atSec'), sec: z.number().min(0) }),
    z.strictObject({ kind: z.literal('action'), match: ActionMatchSchema }),
    StateConditionSchema,
    z.strictObject({ kind: z.literal('ruleFired'), ruleId: z.string().min(1), afterSec: z.number().min(0).optional() }),
    z.strictObject({ kind: z.literal('all'), of: z.array(ConditionSchema).min(1) }),
    z.strictObject({ kind: z.literal('any'), of: z.array(ConditionSchema).min(1) }),
  ]),
);

// ---------------------------------------------------------------------------
// Rules, checks, event sets, content definitions
// ---------------------------------------------------------------------------
export const CueRuleSchema = z.strictObject({
  id: z.string().min(1),
  instructorLabel: z.string().min(1), // instructor console only; never rendered in the headset
  when: ConditionSchema,
  cues: z.array(WorldCueSchema).min(1),
  once: z.boolean().optional(), // default true
  physical: z.boolean().optional(), // still fires in external (Manual) mode
});
export type CueRule = z.infer<typeof CueRuleSchema>;

const base = { id: z.string().min(1), category: ReasonCategorySchema, reason: z.string().min(1) };
export const CheckDefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('required'), ...base, when: ConditionSchema, withinSec: z.number().min(0).optional() }),
  z.strictObject({
    kind: z.literal('errorTrap'),
    ...base,
    when: ConditionSchema,
    trappedWhen: ConditionSchema.optional(),
    trapWithinSec: z.number().min(0).optional(),
    severity: z.enum(['minor', 'major']),
  }),
  z.strictObject({
    kind: z.literal('comm'),
    ...base,
    messageId: z.string().min(1),
    quality: z.record(z.string(), z.enum(['good', 'acceptable', 'poor'])), // must cover exactly the message's cards
  }),
  z.strictObject({ kind: z.literal('safety'), ...base, when: ConditionSchema }),
]);
export type CheckDef = z.infer<typeof CheckDefSchema>;

/**
 * Amendment (user-approved 2026-11-13, T24): optional guided-flight steps. In GUIDED FLIGHT the trainer shows the first
 * applicable step whose `doneWhen` is false, frames the `light` targets that exist and prints `where` and `text`.
 * Pilot-visible text: plain ASCII only (the headset font has no other glyphs).
 */
const ASCII_ONLY = /^[\x20-\x7E]*$/;
const guideText = z.string().min(1).regex(ASCII_ONLY, 'guide text must be plain ASCII');
export const GuideStepSchema = z.strictObject({
  id: z.string().min(1),
  where: guideText, // line 1: where to look
  text: guideText, // line 2: what to do
  light: z.array(ActionMatchSchema).min(1), // targets to frame; more than one = the pilot's own decision
  doneWhen: ConditionSchema,
  onlyWhen: ConditionSchema.optional(), // the step exists only while this is true (branches)
  waitText: guideText.optional(), // shown while none of the `light` targets exists yet
});
export type GuideStep = z.infer<typeof GuideStepSchema>;

export const EventSetDefSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  phase: z.string(),
  environment: z.string(),
  distracters: z.array(z.string()),
  trigger: z.string(),
  technical: z.string(),
  crm: z.string(),
  objective: z.string().min(1),
  instructorNotes: z.string(), // instructor console only; never rendered in the headset
  startCues: z.array(WorldCueSchema),
  rules: z.array(CueRuleSchema),
  endWhen: ConditionSchema,
  checks: z.array(CheckDefSchema),
  hints: z.array(z.string().min(1)),
  guide: z.array(GuideStepSchema).optional(),
});
export type EventSetDef = z.infer<typeof EventSetDefSchema>;

export const ChecklistDefSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  items: z.array(z.strictObject({ id: z.string().min(1), text: z.string().min(1) })).min(1),
});
export type ChecklistDef = z.infer<typeof ChecklistDefSchema>;

export const AirportDefSchema = z.strictObject({ id: z.string().min(1), name: z.string().min(1) });
export type AirportDef = z.infer<typeof AirportDefSchema>;

const ScenarioShape = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  notice: z.string().min(1),
  timeCompression: z.number().positive(),
  latenessGraceSec: z.number().min(0),
  initialAircraft: AircraftStateSchema,
  briefing: z.array(z.strictObject({ id: z.string().min(1), title: z.string(), body: z.string() })),
  airports: z.array(AirportDefSchema).min(1),
  checklists: z.array(ChecklistDefSchema),
  practice: z.strictObject({ controlId: ControlIdSchema, prompt: z.string().min(1) }),
  eventSets: z.array(EventSetDefSchema).min(1),
  endConditions: z.array(z.strictObject({ reason: z.enum(['diversionSetUp', 'continueConfirmed', 'completed']), when: ConditionSchema })),
  softTimeout: z
    .strictObject({
      eventSetId: z.string().min(1),
      promptAtSec: z.number().min(0),
      afterSec: z.number().positive(),
      promptCue: WorldCueSchema,
      // Amendment (lead-approved, Task 7 fix round 1): if true at prompt time, the prompt is not sent.
      skipPromptWhen: ConditionSchema.optional(),
    })
    .refine((t) => t.promptAtSec < t.afterSec, { message: 'softTimeout.promptAtSec must be before afterSec' }),
});
export type Scenario = z.infer<typeof ScenarioShape>;

// ---------------------------------------------------------------------------
// Cross-reference validation: catches authoring mistakes that would otherwise
// produce rules or checks that silently never fire.
// ---------------------------------------------------------------------------
type Path = (string | number)[];

function conditionsOf(c: Condition): Condition[] {
  return c.kind === 'all' || c.kind === 'any' ? [c, ...c.of.flatMap(conditionsOf)] : [c];
}

/** Controls whose guide light needs the value to reach: it decides which pad is framed (plus or minus, which option, which airport). */
const VALUE_LIT_CONTROLS: ReadonlySet<string> = new Set(['ap.hdg', 'ap.alt', 'baro.set', 'ap.lateral', 'ap.vertical', 'route.destination']);

/** Why a guide `light` entry cannot be framed (undefined = it can). Reachability is checked separately. */
function lightProblem(m: ActionMatch): string | undefined {
  switch (m.kind) {
    case 'hint':
      return 'a hint cannot be lit';
    case 'control':
      if (m.controlId === undefined) return 'a control light needs controlId';
      if (m.value === undefined && VALUE_LIT_CONTROLS.has(m.controlId)) return `a '${m.controlId}' light needs a value`;
      return undefined;
    case 'reply':
      return m.messageId === undefined && m.cardId === undefined ? 'a reply light needs messageId or cardId' : undefined;
    case 'checklistItem':
      return m.checklistId === undefined || m.itemId === undefined ? 'a checklistItem light needs checklistId and itemId' : undefined;
    case 'alertAck':
      return m.alertId === undefined ? 'an alertAck light needs alertId' : undefined;
  }
}

/**
 * Runtime semantics the validator assumes (Task 4 must implement exactly these):
 * - An event set's startCues and rules run only while that set is current; sets run in order.
 * - Messages and their reply cards belong to the set that sent them: the comms panel shows the cards of every
 *   unanswered message of the current set (newest first; UI ruling, Task 7 fix round 1) and clears a message's
 *   cards once one is chosen, so reply matches and comm checks may only name messages sent in the SAME set.
 *   Alerts and opened checklists stay reachable for all later sets.
 * - `ruleFired` inside an event set refers to rules of THAT set (per-set fired map, reset on redo).
 *   Scenario-level `endConditions` may reference any rule.
 * - `softTimeout.promptCue` is reachable from `softTimeout.eventSetId` onward. `softTimeout.skipPromptWhen`
 *   (optional) is evaluated once, at prompt time, with the endConditions context; if true the prompt is skipped.
 * - The kneeboard hint button emits `hint` with the CURRENT set's id.
 */
function crossCheck(s: Scenario, add: (message: string, path: Path) => void): void {
  const unique = (ids: string[], what: string, path: (i: number) => Path) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) add(`duplicate ${what} id '${id}'`, path(i));
      seen.add(id);
    });
    return seen;
  };

  const setIds = unique(s.eventSets.map((e) => e.id), 'event set', (i) => ['eventSets', i, 'id']);
  const airportIds = unique(s.airports.map((a) => a.id), 'airport', (i) => ['airports', i, 'id']);
  const checklistDefs = new Map(s.checklists.map((c) => [c.id, new Set(c.items.map((it) => it.id))]));
  unique(s.checklists.map((c) => c.id), 'checklist', (i) => ['checklists', i, 'id']);
  s.checklists.forEach((c, i) => unique(c.items.map((it) => it.id), `checklist '${c.id}' item`, (j) => ['checklists', i, 'items', j, 'id']));

  const rulePaths: [string, Path][] = s.eventSets.flatMap((es, i) => es.rules.map((r, j): [string, Path] => [r.id, ['eventSets', i, 'rules', j, 'id']]));
  const allRuleIds = unique(rulePaths.map(([id]) => id), 'rule', (k) => rulePaths[k][1]);
  const checkPaths: [string, Path][] = s.eventSets.flatMap((es, i) => es.checks.map((c, j): [string, Path] => [c.id, ['eventSets', i, 'checks', j, 'id']]));
  unique(checkPaths.map(([id]) => id), 'check', (k) => checkPaths[k][1]);

  if (!setIds.has(s.softTimeout.eventSetId))
    add(`softTimeout.eventSetId '${s.softTimeout.eventSetId}' is not an event set`, ['softTimeout', 'eventSetId']);
  if (!airportIds.has(s.initialAircraft.destination))
    add(`initial destination '${s.initialAircraft.destination}' is not an airport`, ['initialAircraft', 'destination']);

  // Global message definitions: one definition per id (identical re-sends allowed).
  const messageDefs = new Map<string, Extract<WorldCue, { kind: 'message' }>>();

  // What the pilot can have seen by the time a given set is current (grows set by set).
  const reach = { messages: new Map<string, Set<string>>(), cards: new Set<string>(), alerts: new Set<string>(), checklists: new Set<string>() };
  const absorb = (c: WorldCue, path: Path) => {
    if (c.kind === 'message') {
      const prev = messageDefs.get(c.id);
      if (prev && JSON.stringify(prev) !== JSON.stringify(c)) add(`message id '${c.id}' is reused with different content`, path);
      if (!prev) messageDefs.set(c.id, c);
      const cardIds = (c.cards ?? []).map((k) => k.id);
      unique(cardIds, `message '${c.id}' card`, (j) => [...path, 'cards', j, 'id']);
      reach.messages.set(c.id, new Set([...(reach.messages.get(c.id) ?? []), ...cardIds]));
      cardIds.forEach((k) => reach.cards.add(k));
    }
    if (c.kind === 'alert') reach.alerts.add(c.id);
    if (c.kind === 'checklistAvailable') {
      if (!checklistDefs.has(c.checklistId)) add(`unknown checklist '${c.checklistId}'`, [...path, 'checklistId']);
      else reach.checklists.add(c.checklistId);
    }
    if (c.kind === 'aircraft' && c.patch.destination !== undefined && !airportIds.has(c.patch.destination))
      add(`destination '${c.patch.destination}' is not an airport`, [...path, 'patch', 'destination']);
  };

  /** Validate a condition tree. `ruleScope` = rules a `ruleFired` may name; `setId` = owning set (null at scenario level). */
  const checkCondition = (root: Condition, path: Path, ruleScope: ReadonlySet<string>, setId: string | null) => {
    for (const c of conditionsOf(root)) {
      if (c.kind === 'ruleFired' && !ruleScope.has(c.ruleId))
        add(setId ? `ruleFired '${c.ruleId}' is not a rule of event set '${setId}'` : `ruleFired refers to unknown rule '${c.ruleId}'`, path);
      if (c.kind === 'state' && c.path === 'destination' && !airportIds.has(String(c.value))) add(`destination '${c.value}' is not an airport`, path);
      if (c.kind !== 'action') continue;
      const m = c.match;
      switch (m.kind) {
        case 'reply': {
          if (m.messageId !== undefined) {
            const cards = reach.messages.get(m.messageId);
            if (!cards) add(`reply match: message '${m.messageId}' has not been sent by this point`, path);
            else if (m.cardId !== undefined && !cards.has(m.cardId)) add(`message '${m.messageId}' offers no card '${m.cardId}'`, path);
          } else if (m.cardId !== undefined) {
            if (!reach.cards.has(m.cardId)) add(`no message sent by this point offers card '${m.cardId}'`, path);
          } else if (reach.cards.size === 0) add('reply match: no reply cards have been offered by this point', path);
          break;
        }
        case 'checklistItem': {
          if (m.checklistId !== undefined) {
            if (!reach.checklists.has(m.checklistId)) add(`checklist '${m.checklistId}' has not been opened by this point`, path);
            else if (m.itemId !== undefined && !checklistDefs.get(m.checklistId)!.has(m.itemId))
              add(`checklist '${m.checklistId}' has no item '${m.itemId}'`, path);
          } else if (m.itemId !== undefined) {
            const opened = [...reach.checklists].some((id) => checklistDefs.get(id)!.has(m.itemId!));
            if (!opened) add(`no checklist opened by this point has item '${m.itemId}'`, path);
          } else if (reach.checklists.size === 0) add('checklistItem match: no checklist has been opened by this point', path);
          break;
        }
        case 'alertAck': {
          if (m.alertId !== undefined) {
            if (!reach.alerts.has(m.alertId)) add(`alert '${m.alertId}' has not been raised by this point`, path);
          } else if (reach.alerts.size === 0) add('alertAck match: no alert has been raised by this point', path);
          break;
        }
        case 'hint': {
          if (m.eventSetId !== undefined && (setId ? m.eventSetId !== setId : !setIds.has(m.eventSetId)))
            add(setId ? `hint match names event set '${m.eventSetId}' but hints in '${setId}' carry '${setId}'` : `unknown event set '${m.eventSetId}'`, path);
          break;
        }
        case 'control': {
          if (m.controlId === 'route.destination' && m.value !== undefined && !airportIds.has(String(m.value)))
            add(`destination '${m.value}' is not an airport`, path);
          break;
        }
      }
    }
  };

  const timeoutIndex = s.eventSets.findIndex((es) => es.id === s.softTimeout.eventSetId);
  s.eventSets.forEach((es, i) => {
    reach.messages.clear(); // reply cards are per event set (see runtime semantics above)
    reach.cards.clear();
    es.startCues.forEach((c, j) => absorb(c, ['eventSets', i, 'startCues', j]));
    es.rules.forEach((r, j) => r.cues.forEach((c, k) => absorb(c, ['eventSets', i, 'rules', j, 'cues', k])));
    if (i === timeoutIndex) absorb(s.softTimeout.promptCue, ['softTimeout', 'promptCue']);

    const ownRules = new Set(es.rules.map((r) => r.id));
    es.rules.forEach((r, j) => checkCondition(r.when, ['eventSets', i, 'rules', j, 'when'], ownRules, es.id));
    checkCondition(es.endWhen, ['eventSets', i, 'endWhen'], ownRules, es.id);
    es.checks.forEach((ch, j) => {
      const p: Path = ['eventSets', i, 'checks', j];
      if (ch.kind === 'comm') {
        const def = messageDefs.get(ch.messageId);
        if (!def || !reach.messages.has(ch.messageId))
          return add(`comm check '${ch.id}' refers to message '${ch.messageId}' that no cue sends by this point`, [...p, 'messageId']);
        const offered = new Set((def.cards ?? []).map((k) => k.id));
        const graded = new Set(Object.keys(ch.quality));
        for (const k of offered) if (!graded.has(k)) add(`comm check '${ch.id}' has no quality for card '${k}'`, [...p, 'quality']);
        for (const k of graded) if (!offered.has(k)) add(`comm check '${ch.id}' grades card '${k}' that message '${ch.messageId}' does not offer`, [...p, 'quality']);
        return;
      }
      checkCondition(ch.when, [...p, 'when'], ownRules, es.id);
      if (ch.kind === 'errorTrap' && ch.trappedWhen) checkCondition(ch.trappedWhen, [...p, 'trappedWhen'], ownRules, es.id);
    });
    unique((es.guide ?? []).map((g) => g.id), `guide step (event set '${es.id}')`, (j) => ['eventSets', i, 'guide', j, 'id']);
    (es.guide ?? []).forEach((g, j) => {
      const p: Path = ['eventSets', i, 'guide', j];
      checkCondition(g.doneWhen, [...p, 'doneWhen'], ownRules, es.id);
      if (g.onlyWhen) checkCondition(g.onlyWhen, [...p, 'onlyWhen'], ownRules, es.id);
      g.light.forEach((m, k) => {
        const lp: Path = [...p, 'light', k];
        const problem = lightProblem(m);
        if (problem) return add(`guide step '${g.id}': ${problem}`, lp);
        checkCondition({ kind: 'action', match: m }, lp, ownRules, es.id); // the target must be reachable in this set
      });
    });
  });
  // Scenario-level end conditions: everything is reachable; any rule may be named.
  s.endConditions.forEach((e, i) => checkCondition(e.when, ['endConditions', i, 'when'], allRuleIds, null));
  // softTimeout.skipPromptWhen is evaluated like endConditions (scenario-level scope).
  if (s.softTimeout.skipPromptWhen) checkCondition(s.softTimeout.skipPromptWhen, ['softTimeout', 'skipPromptWhen'], allRuleIds, null);
}

export const ScenarioSchema = ScenarioShape.superRefine((s, ctx) =>
  crossCheck(s, (message, path) => ctx.addIssue({ code: 'custom', message, path })),
);

/** Validate a scenario file. Throws ZodError (with paths) on any problem. */
export function parseScenario(input: unknown): Scenario {
  return ScenarioSchema.parse(input);
}
