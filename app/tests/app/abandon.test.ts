// T51: RESTART on the Paused screen. The run is abandoned (no debrief, scores discarded), everything of it is cleared and the flow goes
// to the flight picker, or to the mode screen when one flight is registered. Headless, over the two-flight fixture registry.
import { describe, expect, it } from 'vitest';
import { FLIGHT_A, mkFlightRig, type Rig } from './flightFixtures';

/** Fly flight A partway: choose the mode, Begin, let a reply and a printout happen, then pause from the kneeboard. */
function pauseMidRun(r: Rig, mode: 'auto' | 'guided' = 'auto'): void {
  r.app.continue();
  r.app.chooseFlight('fx-a');
  if (mode === 'guided') r.app.chooseGuided();
  else r.app.chooseAuto();
  if (r.app.state === 'practice') r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
  r.app.begin();
  r.tick(6); // the printout of the first set arrives at 5 s
  r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
  r.tick(1);
  r.app.pause();
  expect(r.app.state).toBe('paused');
}

describe('TrainerApp.abandon (T51)', () => {
  it('goes to the flight picker with no debrief, no scores, and every panel, alert and sound of the run cleared', () => {
    const r = mkFlightRig({ rnd: [0] });
    pauseMidRun(r);
    expect(r.panels.comms.lastMessages(10).length).toBeGreaterThan(0);
    expect(r.panels.kneeboard.entries().some((e) => e.body === 'Alpha printout 0')).toBe(true);
    const states: string[] = [];
    r.app.onChange((s) => states.push(s));
    const resets = r.displays.resets;
    const audioResets = r.audio.resets;
    r.app.abandon();
    expect(r.app.state).toBe('flightSelect');
    expect(states, 'straight to the picker: no debrief on the way').toEqual(['flightSelect']);
    expect(r.app.results().original).toEqual([]);
    expect(r.app.results().redo).toBeUndefined();
    expect(r.panels.comms.lastMessages(10)).toEqual([]);
    expect(r.panels.comms.pendingCards()).toEqual([]);
    expect(r.panels.kneeboard.entries().some((e) => e.body === 'Alpha printout 0')).toBe(false);
    expect(r.displays.resets).toBeGreaterThan(resets);
    expect(r.audio.resets).toBeGreaterThan(audioResets);
    expect(r.app.crewCaption.current(performance.now())).toBeNull();
    expect(r.app.guide()).toBeNull();
  });

  it('the fresh engine waits paused for Begin: the clock does not run and nothing reaches the panels until then', () => {
    const r = mkFlightRig({ rnd: [0] });
    pauseMidRun(r);
    const cuesBefore = r.panels.cues.length;
    r.app.abandon();
    r.tick(5);
    expect(r.panels.cues.length).toBe(cuesBefore);
    expect(r.app.session.engine.status.tInSet).toBe(0);
    expect(r.app.session.engine.status.eventSetId).toBe('fxa-es-a');
    // actions at the picker are not taken
    r.act({ kind: 'control', controlId: 'lights.landing', value: true });
    expect(r.app.session.engine.actionsFor('fxa-es-a')).toEqual([]);
  });

  it('picking the same flight again starts a clean run: first Event Set, only fresh cues, nothing of the abandoned run', () => {
    const r = mkFlightRig({ rnd: [0, 0] });
    pauseMidRun(r);
    const old = r.app.session.engine;
    r.app.abandon();
    r.app.chooseFlight('fx-a');
    expect(r.app.state).toBe('modeSelect');
    r.app.chooseAuto();
    expect(r.app.state).toBe('briefing'); // the practice step was done in this page session
    const cuesBefore = r.panels.cues.length;
    r.app.begin();
    expect(r.app.state).toBe('running');
    const fresh = r.panels.cues.slice(cuesBefore);
    expect(fresh[0].body).toEqual({ kind: 'eventSet', eventSetId: 'fxa-es-a', status: 'start' });
    expect(r.panels.comms.lastMessages(10).map((m) => m.text)).not.toContain('Alpha reply done');
    r.tick(1);
    expect(r.app.session.engine.status.tInSet).toBeGreaterThan(0);
    expect(r.app.session.engine).not.toBe(old);
    expect(r.app.results().original).toEqual([]);
    // the replaced engine is detached: it cannot end this run
    expect(r.app.state).toBe('running');
  });

  it('picking the other flight swaps cleanly: nothing of the abandoned one remains', () => {
    const r = mkFlightRig({ rnd: [0] });
    pauseMidRun(r);
    r.app.abandon();
    r.app.chooseFlight('fx-b');
    r.app.chooseAuto();
    expect(r.app.state).toBe('briefing');
    expect(r.app.scenario.id).toBe('fxb-v0');
    expect(r.panels.comms.lastMessages(10)).toEqual([]);
    expect(r.panels.kneeboard.entries().map((e) => e.id)).toEqual(['brief-1']);
    expect(r.panels.checklist.current()).toBeNull();
  });

  it('with one flight it goes to the mode screen, like the debrief RESTART', () => {
    const r = mkFlightRig({ flights: [FLIGHT_A] });
    r.app.continue();
    r.app.chooseAuto();
    r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
    r.app.begin();
    r.tick(2);
    r.app.pause();
    r.app.abandon();
    expect(r.app.state).toBe('modeSelect');
    r.app.chooseAuto();
    expect(r.app.state).toBe('briefing');
  });

  it('does nothing unless the flow is paused: the run in progress and every other screen are untouched', () => {
    const r = mkFlightRig({ rnd: [0] });
    r.app.abandon();
    expect(r.app.state).toBe('welcome');
    r.app.continue();
    r.app.abandon();
    expect(r.app.state).toBe('flightSelect');
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
    r.app.abandon();
    expect(r.app.state).toBe('briefing');
    r.app.begin();
    r.tick(6);
    const t = r.app.session.engine.status.tInSet;
    const messages = r.panels.comms.lastMessages(10).length;
    r.app.abandon();
    expect(r.app.state).toBe('running');
    r.tick(1);
    expect(r.app.session.engine.status.tInSet).toBeGreaterThan(t);
    expect(r.panels.comms.lastMessages(10).length).toBeGreaterThanOrEqual(messages);
  });

  it('GUIDED: the guide is gone at the picker, and the seat/practice/guide settings carry on (practice is not asked again)', () => {
    const r = mkFlightRig({ rnd: [0] });
    pauseMidRun(r, 'guided');
    expect(r.app.guided).toBe(true);
    r.app.abandon();
    expect(r.app.guide()).toBeNull();
    r.app.chooseFlight('fx-a');
    r.app.chooseGuided();
    expect(r.app.state).toBe('briefing'); // practiceCompleted stays true
    expect(r.app.guided).toBe(true);
    r.app.begin();
    expect(r.app.state).toBe('running');
  });

  it('leaving and returning to the page while at the picker changes nothing; a hidden page cannot pause a menu', () => {
    const r = mkFlightRig({ rnd: [0] });
    pauseMidRun(r);
    r.app.abandon();
    r.app.visibility('hidden');
    expect(r.app.state).toBe('flightSelect');
    r.app.visibility('visible');
    expect(r.app.state).toBe('flightSelect');
  });

  it('abandoning a REDO pause also works: the redo is dropped with the rest', () => {
    const r = mkFlightRig({ rnd: [0] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
    r.app.begin();
    r.tick(1);
    r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    r.act({ kind: 'control', controlId: 'lights.landing', value: true });
    r.tick(1);
    r.act({ kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(r.app.state).toBe('debrief');
    r.app.redo('fxa-es-a');
    expect(r.app.state).toBe('redo');
    r.app.pause();
    r.app.abandon();
    expect(r.app.state).toBe('flightSelect');
    expect(r.app.results().original).toEqual([]);
    expect(r.app.results().redo).toBeUndefined();
  });
});
