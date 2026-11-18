// Pure timeline builder: turns one Event Set's recorded history into the lines the debrief shows.
// No rendering imports: runs headless in Node. Reads the same history the grader reads and changes nothing in it.
import type { ControlId } from '../contracts/aircraft';
import type { Channel, PilotAction, Stamped, WorldCue } from '../contracts/events';
import type { EventSetDef, Scenario } from '../contracts/scenario';
import type { SetHistory } from './conditions';
import type { ElecMoment } from './power';

export interface TimelineEntry {
  /** Seconds since the Event Set began. */
  tSec: number;
  who: 'event' | 'you';
  /** Printable ASCII. */
  text: string;
}

/** The debrief record of one attempt at one Event Set. */
export interface SetReview {
  entries: TimelineEntry[];
  /** Electrical states to draw; `null` when the electrical state never changed. */
  elec: ElecMoment[] | null;
}

export const CHANNEL_TAGS: Readonly<Record<Channel, string>> = Object.freeze({
  atc: 'ATC',
  cabin: 'CABIN',
  dispatch: 'DISPATCH',
  ground: 'GROUND',
  crew: 'F/O',
});

/** Names as printed in the cockpit (label panels and panel buttons); see the Control names note in the task report. */
export const CONTROL_NAMES: Readonly<Record<ControlId, string>> = Object.freeze({
  'ap.hdg': 'HDG',
  'ap.alt': 'ALT',
  'ap.engage': 'AP',
  'ap.lateral': 'LATERAL',
  'ap.vertical': 'VERTICAL',
  'baro.set': 'BARO',
  'lights.landing': 'LAND',
  'lights.strobe': 'STROBE',
  'elec.gen1': 'GEN 1',
  'elec.gen2': 'GEN 2',
  'elec.busTie': 'BUS TIE',
  'radio.com1': 'COM1',
  'route.destination': 'DESTINATION',
  'pa.cabin': 'PA',
  'practice.toggle': 'PRACTICE MODE',
});

/** Minutes and seconds, seconds floored: 0 -> '0:00', 74.9 -> '1:14', 600 -> '10:00'. */
export function formatClock(tSec: number): string {
  const total = Math.max(0, Math.floor(tSec + 1e-9));
  const s = total % 60;
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`;
}

// ---------------------------------------------------------------------------------------------------

type MessageCue = Extract<WorldCue, { kind: 'message' }>;
type AlertCue = Extract<WorldCue, { kind: 'alert' }>;

interface Lookup {
  message(id: string): MessageCue | undefined;
  alertText(id: string): string | undefined;
}

/** Every cue the scenario can send, wherever it lives (start cues, rules, the soft-timeout prompt). */
function allCues(scenario: Scenario): WorldCue[] {
  return [
    ...scenario.eventSets.flatMap((es) => [...es.startCues, ...es.rules.flatMap((r) => r.cues)]),
    scenario.softTimeout.promptCue,
  ];
}

function lookupFor(scenario: Scenario): Lookup {
  const cues = allCues(scenario);
  return {
    message: (id) => cues.find((c): c is MessageCue => c.kind === 'message' && c.id === id),
    alertText: (id) => cues.find((c): c is AlertCue => c.kind === 'alert' && c.id === id)?.text,
  };
}

function controlValueText(scenario: Scenario, id: ControlId, value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'number') return id === 'ap.hdg' ? String(Math.round(value)).padStart(3, '0') : String(value);
  if (id === 'route.destination') return scenario.airports.find((a) => a.id === value)?.name ?? value.toUpperCase();
  return value.toUpperCase();
}

function cueText(scenario: Scenario, look: Lookup, cue: WorldCue): string | undefined {
  switch (cue.kind) {
    case 'message':
      return `${CHANNEL_TAGS[cue.channel] ?? cue.channel.toUpperCase()}: ${cue.text}`;
    case 'alert':
      return `ALERT: ${cue.text}`;
    case 'alertClear':
      return `ALERT CLEARED: ${look.alertText(cue.id) ?? cue.id}`;
    case 'printout':
      return `KNEEBOARD: ${cue.title}`;
    case 'checklistAvailable':
      return `CHECKLIST OPEN: ${scenario.checklists.find((c) => c.id === cue.checklistId)?.title ?? cue.checklistId}`;
    default:
      return undefined; // aircraft, eventSet, scenarioEnd: nothing the pilot is shown as an event
  }
}

function actionText(scenario: Scenario, look: Lookup, a: PilotAction): string {
  switch (a.kind) {
    case 'control':
      return `${CONTROL_NAMES[a.controlId]} ${controlValueText(scenario, a.controlId, a.value)}`;
    case 'reply': {
      const msg = look.message(a.messageId);
      const card = msg?.cards?.find((c) => c.id === a.cardId);
      return `REPLY TO ${msg ? CHANNEL_TAGS[msg.channel] : a.messageId}: ${card?.text ?? a.cardId}`;
    }
    case 'checklistItem': {
      const item = scenario.checklists.find((c) => c.id === a.checklistId)?.items.find((i) => i.id === a.itemId);
      return `CHECKED: ${item?.text ?? a.itemId}`;
    }
    case 'alertAck':
      return `ACKNOWLEDGED: ${look.alertText(a.alertId) ?? a.alertId}`;
    case 'hint':
      return 'HINT REQUESTED';
  }
}

/**
 * The lines of one attempt at one Event Set, in time order.
 * Time zero is the moment the set began (`now - tInSet` of the last snapshot). Start cues are at 0, a rule's cues
 * at the time it last fired, a pilot action at its own time. A run of presses of the same NUMBER control (HDG, ALT,
 * BARO steppers) with no other action between them is one line at the last one's time with the last one's value;
 * switch and selector presses each keep their own line, because a switch cycled off and on is exactly what some checks
 * grade. At equal times the order is what actually happened: start cues first, then actions and rule cues in the
 * engine's own sequence. A rule's cues go after the actions dispatched before it fired and before any later action, so
 * an action and the alert it triggers come before the acknowledgement of that alert. Checklist re-ticks keep only the
 * first confirmation per checklist/item in this attempt; their raw actions remain available to the engine and grader.
 * The snapshot the engine takes
 * right after each firing records how many actions preceded it. Otherwise source order is kept.
 */
export function buildTimeline(scenario: Scenario, def: EventSetDef, history: SetHistory): TimelineEntry[] {
  const last = history.snapshots[history.snapshots.length - 1];
  if (!last) return [];
  const look = lookupFor(scenario);
  const startT = last.ctx.now - last.ctx.tInSet;
  const rel = (t: number) => Math.max(0, t - startT);
  // order sorts entries at the same instant: -1 start cue, 2i+1 the i-th action, 2n a rule cue fired after n actions.
  const out: Array<TimelineEntry & { order: number }> = [];
  const addCues = (cues: readonly WorldCue[], tSec: number, order: number) => {
    for (const c of cues) {
      const text = cueText(scenario, look, c);
      if (text !== undefined) out.push({ tSec, who: 'event', text, order });
    }
  };

  addCues(def.startCues, 0, -1);
  for (const rule of def.rules) {
    const firedAt = last.ctx.fired.get(rule.id);
    if (firedAt === undefined) continue;
    // The first snapshot showing this (last) firing was taken right after it; unknown -> after every action so far.
    const snap = history.snapshots.find((s) => s.ctx.fired.get(rule.id) === firedAt);
    addCues(rule.cues, rel(firedAt), 2 * (snap ?? last).ctx.actions.length);
  }

  const actions: Stamped<PilotAction>[] = last.ctx.actions;
  const checked = new Set<string>();
  actions.forEach((a, i) => {
    if (a.body.kind === 'checklistItem') {
      const key = JSON.stringify([a.body.checklistId, a.body.itemId]);
      if (checked.has(key)) return;
      checked.add(key);
    }
    const next = actions[i + 1]?.body;
    // A number-control press that the very next action (same control) replaces is not shown: only the last of a run is.
    if (a.body.kind === 'control' && typeof a.body.value === 'number' && next?.kind === 'control' && next.controlId === a.body.controlId) return;
    out.push({ tSec: rel(a.t), who: 'you', text: actionText(scenario, look, a.body), order: 2 * i + 1 });
  });

  // Array.prototype.sort is stable: equal keys keep source order.
  return out.sort((x, y) => x.tSec - y.tSec || x.order - y.order).map(({ tSec, who, text }) => ({ tSec, who, text }));
}
