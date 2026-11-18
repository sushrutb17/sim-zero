// Shared follow-the-lights player; baseline assertions remain in guide-follow.test.ts.
import { currentGuide, guideWorldFromModels, type GuideView } from '../../src/app/guide';
import type { PilotAction } from '../../src/contracts/events';
import type { ActionMatch, Scenario } from '../../src/contracts/scenario';
import { TrainingSession } from '../../src/engine/session';
import singleSource from '../../src/scenarios/single-source';
import { ackAlert, alertsReducer, type ActiveAlert } from '../../src/xr/displays/alerts';
import { ChecklistModel, CommsModel } from '../../src/xr/panels/panelModel';

const DT = 0.1;
const MAX_REAL_SEC = 900;

interface Rig {
  session: TrainingSession;
  comms: CommsModel;
  act(a: PilotAction): void;
}
interface PlayOptions {
  /** Card id to take at each decision step, by step id. */
  decisions: Record<string, string>;
  /** Called every half second before the guide is read (off-script presses). */
  offScript?: (rig: Rig) => void;
  /** Simulate the real climb stepper buttons (HDG 10 degrees, ALT 1,000 feet) instead of jumping to targets. */
  stepClimbControls?: boolean;
  /** Real seconds between guide presses, including the setup before the heading adjustment. */
  pressIntervalSec?: number;
}

export function play(opts: PlayOptions, scenario: Scenario = singleSource) {
  const session = new TrainingSession(scenario, { mode: 'auto' });
  session.setPatience(2); // a guided flight runs at patience 2 (TrainerApp.begin)
  const comms = new CommsModel();
  const checklist = new ChecklistModel(scenario.checklists);
  let alerts: ActiveAlert[] = [];
  session.onCue(({ body }) => {
    comms.apply(body);
    if (body.kind === 'checklistAvailable') checklist.open(body.checklistId);
    alerts = alertsReducer(alerts, body);
  });
  const world = guideWorldFromModels(comms, checklist, () => alerts);
  session.start();
  const e = session.engine;
  const act = (a: PilotAction) => e.dispatch(a);
  const rig: Rig = { session, comms, act };
  const decisionsMet: { stepId: string; options: number }[] = [];
  const stepsShown = new Set<string>();
  const firstGuideBySet = new Map<string, string>();
  const headingPresses: number[] = [];
  let nextPressAt = 0;

  const perform = (m: ActionMatch): void => {
    if (m.kind === 'control') return act({ kind: 'control', controlId: m.controlId!, value: m.value ?? true });
    if (m.kind === 'reply') {
      const card = comms.pendingCards().find((c) => (m.messageId === undefined || c.messageId === m.messageId) && (m.cardId === undefined || c.cardId === m.cardId));
      if (!card) throw new Error(`framed card is not pending: ${JSON.stringify(m)}`);
      const a = comms.choose(card.messageId, card.cardId);
      if (!a) throw new Error(`comms refused ${card.messageId}/${card.cardId}`);
      return act(a);
    }
    if (m.kind === 'checklistItem') {
      const r = checklist.tick(m.itemId!);
      if (!r) throw new Error(`checklist refused ${m.itemId}`);
      return act(r.action);
    }
    if (m.kind === 'alertAck') {
      alerts = ackAlert(alerts, m.alertId!);
      return act({ kind: 'alertAck', alertId: m.alertId! });
    }
    throw new Error(`cannot perform ${m.kind}`);
  };

  const choose = (view: GuideView): ActionMatch => {
    if (view.targets.length === 1) return view.targets[0];
    const want = opts.decisions[view.stepId];
    if (!want) throw new Error(`no decision supplied for ${view.stepId}`);
    if (!decisionsMet.some((d) => d.stepId === view.stepId)) decisionsMet.push({ stepId: view.stepId, options: view.targets.length });
    const t = view.targets.find((x) => x.kind === 'reply' && x.cardId === want);
    if (!t) throw new Error(`${view.stepId}: '${want}' is not among the framed options ${JSON.stringify(view.targets)}`);
    return t;
  };

  let real = 0;
  while (e.status.run === 'running') {
    if (real > MAX_REAL_SEC) throw new Error(`still running after ${MAX_REAL_SEC} s: ${JSON.stringify(e.status)}`);
    for (let i = 0; i < 5 && e.status.run === 'running'; i++) e.tick(DT);
    real += 5 * DT;
    if (e.status.run !== 'running') break;
    opts.offScript?.(rig);
    const ctx = e.conditionContext();
    if (!ctx) break;
    const set = scenario.eventSets.find((s) => s.id === e.status.eventSetId)!;
    const view = currentGuide(set.guide, ctx, world);
    if (!view) continue;
    stepsShown.add(view.stepId);
    if (!firstGuideBySet.has(set.id)) firstGuideBySet.set(set.id, view.stepId);
    if (view.targets.length === 0) continue;
    if (real < nextPressAt) continue;
    const target = choose(view);
    if (opts.stepClimbControls && view.stepId.startsWith('g2-') && target.kind === 'control' && (target.controlId === 'ap.hdg' || target.controlId === 'ap.alt')) {
      const heading = target.controlId === 'ap.hdg';
      const from = heading ? e.state.ap.hdg : e.state.ap.alt;
      const value = from + Math.sign(Number(target.value) - from) * (heading ? 10 : 1000);
      if (heading) headingPresses.push(value);
      act({ kind: 'control', controlId: target.controlId, value });
    } else perform(target);
    nextPressAt = real + (opts.pressIntervalSec ?? 0);
  }
  return { endReason: e.status.endReason, grades: session.results().original.map((g) => g.grade), reasons: session.results().original.map((g) => g.reasons.map((r) => r.text)), decisionsMet, stepsShown, firstGuideBySet, headingPresses, es3Entry: e.snapshotAt('es3-gen-failure').state, real };
}
