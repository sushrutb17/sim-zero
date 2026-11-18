/**
 * DEV ONLY demo driver (`?demo=panels`): feeds REAL single-source cues through Panels.handleCue so the four panels can be
 * checked in the emulator before the engine is wired (Task 11). On load: Event Set 1 start (eventSet cue, ATIS + takeoff-data
 * printouts, the first Tower message with its two cards, the Before takeoff checklist). window.__trainer.panelsDemo has:
 *   es1()  restart that state             es4()  an ES4-like pile-up: Dispatch/Center/cabin messages, 13 unanswered cards
 *   reset() panels.reset()                pause  how many times the kneeboard Pause button fired
 * Not part of production builds (index.ts imports this module only when MODE !== 'production').
 */
import type { EventBus } from '../../bus/eventBus';
import type { Stamped, WorldCue } from '../../contracts/events';
import { singleSource } from '../../scenarios/single-source';
import type { Panels } from './index';

let seq = 0;
const stamp = (body: WorldCue): Stamped<WorldCue> => ({ t: seq, seq: ++seq, body });

function setCues(id: string): WorldCue[] {
  const es = singleSource.eventSets.find((e) => e.id === id)!;
  return [{ kind: 'eventSet', eventSetId: id, status: 'start' }, ...es.startCues];
}

function ruleCues(setId: string, ruleIds: string[]): WorldCue[] {
  const es = singleSource.eventSets.find((e) => e.id === setId)!;
  return es.rules.filter((r) => ruleIds.includes(r.id)).flatMap((r) => r.cues);
}

export function startPanelsDemo(panels: Panels, _bus: EventBus): void {
  const feed = (cues: WorldCue[]) => cues.forEach((c) => panels.handleCue(stamp(c)));
  panels.setAircraft({ ...singleSource.initialAircraft });
  const state = { pauses: 0 };
  panels.onPause(() => state.pauses++);
  const es1 = () => {
    panels.reset();
    feed(setCues('es1-before-takeoff'));
  };
  const es4 = () => {
    panels.reset();
    feed(setCues('es4-decision'));
    feed(ruleCues('es4-decision', ['es4-center-asks']));
    // the pile-up: the concern/re-offer messages and the cabin PA arrive while earlier ones are still unanswered
    const es = singleSource.eventSets.find((e) => e.id === 'es4-decision')!;
    const extra = es.rules.flatMap((r) => r.cues).filter((c) => c.kind === 'message' && ['dsp-concern', 'dsp-reoffer', 'pa-cabin'].includes(c.id));
    feed(extra);
  };
  es1();
  const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
  g.__trainer = { ...g.__trainer, panelsDemo: { es1, es4, reset: () => panels.reset(), state, panels } };
}
