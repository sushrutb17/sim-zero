// T41: choosing a flight and swapping the active scenario at run time (headless; two-flight fixture registry, fake panels
// built on the real panel models). Step 2 covers the controller's choices, step 4 the whole swap.
import { describe, expect, it } from 'vitest';
import { DEV_SECOND_VARIATION, devSecondFlight, parseFlightOverride } from '../../src/app/flightOverride';
import { FLIGHTS } from '../../src/scenarios/registry';
import { ChecklistModel } from '../../src/xr/panels/panelModel';
import { TrainerApp } from '../../src/app/controller';
import { EventBus } from '../../src/bus/eventBus';
import { miniScenario } from '../fixtures/mini-scenario';
import { parseScenario } from '../../src/contracts/scenario';
import { FLIGHT_A, FLIGHT_B, FLIGHT_C, TWO_FLIGHTS, flyToDebrief, mkFlightRig, type Rig } from './flightFixtures';

describe('flight choice (controller)', () => {
  it('with two flights: welcome -> picker -> mode screen; the picked flight is remembered, the scenario is not swapped yet', () => {
    const r = mkFlightRig();
    expect(r.app.state).toBe('welcome');
    expect(r.app.flights.map((f) => f.id)).toEqual(['fx-a', 'fx-b']);
    expect(r.app.scenario.id).toBe('fxa-v0');
    r.app.continue();
    expect(r.app.state).toBe('flightSelect');
    r.app.chooseFlight('nope');
    expect(r.app.state).toBe('flightSelect');
    r.app.chooseFlight('fx-b');
    expect(r.app.state).toBe('modeSelect');
    expect(r.app.flight.id).toBe('fx-b');
    expect(r.app.scenario.id).toBe('fxa-v0'); // the scenario is chosen with the mode
    expect(r.panels.scenarios).toEqual([]);
  });

  it('chooseFlight does nothing outside the picker', () => {
    const r = mkFlightRig();
    r.app.chooseFlight('fx-b');
    expect(r.app.state).toBe('welcome');
    expect(r.app.flight.id).toBe('fx-a');
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseFlight('fx-b');
    expect(r.app.flight.id).toBe('fx-a');
  });

  it('with one flight there is no picker and continue goes to the mode screen, as before', () => {
    const r = mkFlightRig({ flights: [FLIGHT_A] });
    r.app.continue();
    expect(r.app.state).toBe('modeSelect');
  });

  it('a caller that passes only a scenario gets a single flight: no picker, no swap', () => {
    const bus = new EventBus();
    const scenario = parseScenario(structuredClone(miniScenario));
    const app = new TrainerApp({
      scenario,
      bus,
      controls: new Map(),
      panels: { handleCue() {}, setScenario() { throw new Error('no swap expected'); }, setAircraft() {}, reset() {}, onPause() {}, setLive() {} },
      displays: { setAircraft() {}, resetAlerts() {}, setAirportNames() {} },
    });
    expect(app.flights).toHaveLength(1);
    expect(app.scenario).toBe(scenario);
    app.continue();
    expect(app.state).toBe('modeSelect');
    app.chooseAuto();
    expect(app.scenario).toBe(scenario);
    expect(() => new TrainerApp({ bus, controls: new Map(), panels: {} as never, displays: {} as never })).toThrow(/scenario or at least one flight/);
  });

  it('GUIDED FLIGHT always flies the baseline and draws nothing', () => {
    const r = mkFlightRig({ stored: { 'fx-a': 2 } });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseGuided();
    expect(r.app.guided).toBe(true);
    expect(r.app.variation).toBe(0);
    expect(r.app.scenario.id).toBe('fxa-v0');
    expect(r.draws).toEqual([]);
    expect(r.stored.get('fx-a')).toBe(0);
  });

  it('GUIDED FLIGHT on a flight with guided: false is ignored: same screen, no swap, still unguided', () => {
    const r = mkFlightRig();
    r.app.continue();
    r.app.chooseFlight('fx-b');
    r.app.chooseGuided();
    expect(r.app.state).toBe('modeSelect');
    expect(r.app.guided).toBe(false);
    expect(r.app.scenario.id).toBe('fxa-v0');
    expect(r.panels.scenarios).toEqual([]);
    r.app.chooseAuto();
    expect(r.app.state).toBe('practice');
    expect(r.app.scenario.id).toBe('fxb-v0');
  });

  it('PRACTISE ALONE draws a variation that is not the one flown last, and remembers it', () => {
    const r = mkFlightRig({ stored: { 'fx-a': 0 }, rnd: [0.99] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    expect(r.draws).toEqual([0.99]);
    expect(r.app.guided).toBe(false);
    expect(r.app.variation).toBe(2); // 3 variations without 0: [1, 2]; 0.99 -> the second
    expect(r.app.scenario.id).toBe('fxa-v2');
    expect(r.stored.get('fx-a')).toBe(2);
    expect(r.panels.scenarios.map((s) => s.id)).toEqual(['fxa-v2']);
  });

  it('with nothing remembered any variation can come up; a flight with one variation never swaps within itself', () => {
    const r = mkFlightRig({ rnd: [0, 0] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    expect(r.app.variation).toBe(0);
    expect(r.panels.scenarios).toEqual([]); // the app already holds variation 0
    const one = mkFlightRig({ flights: [FLIGHT_B], rnd: [0.7] });
    one.app.continue();
    one.app.chooseAuto();
    expect(one.app.variation).toBe(0);
    expect(one.panels.scenarios).toEqual([]);
  });

  it('a stored value that is out of range or junk does not break the draw', () => {
    const r = mkFlightRig({ stored: { 'fx-a': 99 }, rnd: [0.5] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    expect(r.app.variation).toBe(1); // 99 is outside [0, 3): nothing is excluded
  });

  it('the swap pushes the new flight to the panels, the displays and the aircraft state', () => {
    const r = mkFlightRig({ rnd: [0.5] });
    r.app.continue();
    r.app.chooseFlight('fx-b');
    r.app.chooseAuto();
    const b = FLIGHT_B.build(0);
    expect(r.panels.scenarios).toEqual([b]);
    expect(r.displays.names).toEqual({ dep: 'Bravo departure', dest: 'Bravo destination' });
    expect(r.displays.aircraft).toEqual(b.initialAircraft);
    expect(r.panels.checklist.current()).toBeNull();
    expect(r.app.session.engine.status.run).toBe('idle');
    expect(r.app.state).toBe('practice');
  });
});

describe('dev override (?flight=&variation=)', () => {
  const flights = [{ id: 'fx-a', variations: 3 }, { id: 'fx-b', variations: 1 }];

  it('parses a flight and a variation, ignoring what does not exist', () => {
    expect(parseFlightOverride('?flight=fx-b&variation=0', flights)).toEqual({ flight: 'fx-b', variation: 0 });
    expect(parseFlightOverride('?variation=2', flights)).toEqual({ variation: 2 });
    expect(parseFlightOverride('?flight=fx-a&variation=3', flights)).toEqual({ flight: 'fx-a' });
    expect(parseFlightOverride('?flight=fx-b&variation=1', flights)).toEqual({ flight: 'fx-b' });
    expect(parseFlightOverride('?flight=zzz&variation=1', flights)).toEqual({});
    expect(parseFlightOverride('?variation=-1', flights)).toEqual({});
    expect(parseFlightOverride('?variation=1.5', flights)).toEqual({});
    expect(parseFlightOverride('?variation=abc', flights)).toEqual({});
    expect(parseFlightOverride('', flights)).toEqual({});
    expect(parseFlightOverride('?variation=0', [])).toEqual({});
  });

  it('?flights=2 asks for the dev second flight; anything else does not', () => {
    expect(parseFlightOverride('?flights=2', flights)).toEqual({ extraFlight: true });
    expect(parseFlightOverride('?flights=3', flights)).toEqual({});
    expect(parseFlightOverride('?flights=2&flight=fx-b&variation=0', flights)).toEqual({ extraFlight: true, flight: 'fx-b', variation: 0 });
  });

  it('the dev second flight is the first flight at a fixed variation, with no guide, and its own id', () => {
    const second = devSecondFlight(FLIGHTS[0]);
    expect(second).toMatchObject({ id: 'dev-second', guided: false, variations: 1 });
    expect(FLIGHTS.some((f) => f.id === second.id)).toBe(false);
    const base = FLIGHTS[0].build(Math.min(DEV_SECOND_VARIATION, FLIGHTS[0].variations - 1));
    expect(second.build(0)).toBe(base);
    expect(second.build(0)).not.toBe(FLIGHTS[0].build(0));
    // it must differ from the baseline where the emulator specs look: the checklist titles
    expect(new ChecklistModel(base.checklists).titles()).not.toEqual(new ChecklistModel(FLIGHTS[0].build(0).checklists).titles());
    expect(devSecondFlight({ ...FLIGHT_B, variations: 1 }).build(0)).toBe(FLIGHT_B.build(0));
  });

  it('opens in the named flight and variation, and pins the variation for every draw', () => {
    const r = mkFlightRig({ flights: [FLIGHT_A, FLIGHT_B, FLIGHT_C], devOverride: { flight: 'fx-c', variation: 1 }, rnd: [0.99, 0.99] });
    expect(r.app.scenario.id).toBe('fxc-v1');
    expect(r.app.flight.id).toBe('fx-c');
    r.app.continue();
    r.app.chooseFlight('fx-c');
    r.app.chooseAuto();
    expect(r.app.scenario.id).toBe('fxc-v1');
    expect(r.draws).toEqual([]);
    expect(r.panels.scenarios).toEqual([]); // nothing to swap
  });

  it('a pinned variation applies to the picked flight too, when it exists there', () => {
    const r = mkFlightRig({ devOverride: { variation: 2 } });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    expect(r.app.scenario.id).toBe('fxa-v2');
    expect(r.draws).toEqual([]);
  });

  it('flies a fixture to the debrief at the pinned variation', () => {
    const r = mkFlightRig({ devOverride: { variation: 1 } });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyToDebrief(r);
    expect(r.app.scenario.id).toBe('fxa-v1');
    expect(TWO_FLIGHTS).toHaveLength(2);
  });
});

// ---- Review focus 3: a flight changed after a completed flight leaves nothing of the previous one ----

/** Fly the active fixture scenario with enough going on to leave residue: replies, a printout, an open checklist with a tick. */
function flyWithResidue(r: Rig, mode: 'auto' | 'guided' = 'auto'): void {
  if (mode === 'guided') r.app.chooseGuided();
  else r.app.chooseAuto();
  if (r.app.state === 'practice') r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
  r.app.begin();
  r.tick(6); // the printout of the first set arrives at 5 s
  r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
  r.act({ kind: 'control', controlId: 'lights.landing', value: true });
  r.tick(1);
  const tick = r.panels.checklist.tick('a1'); // the second set opened the checklist
  if (tick) r.act(tick.action);
  r.act({ kind: 'control', controlId: 'route.destination', value: 'dep' });
  if (r.app.state !== 'debrief') throw new Error(`expected the debrief, flow is ${r.app.state}`);
}

const setIdsOf = (r: Rig) => r.app.debrief().map((row) => row.eventSetId);
const everyText = (r: Rig) => [
  ...r.panels.comms.lastMessages(50).map((m) => m.text),
  ...r.panels.kneeboard.entries().map((e) => `${e.title} ${e.body}`),
  ...(r.panels.checklist.current() ? [r.panels.checklist.current()!.title] : []),
  ...r.panels.route.rows().map((x) => x.name),
  ...Object.values(r.displays.names),
];

describe('swapping flights after a completed flight (headless, two-flight fixture)', () => {
  it('flight A to the debrief, RESTART, pick flight B: everything shown belongs to B and nothing of A remains', () => {
    const r = mkFlightRig({ rnd: [0] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyWithResidue(r);
    // what A left behind
    expect(setIdsOf(r)).toEqual(['fxa-es-a', 'fxa-es-b']);
    expect(r.app.debrief().map((x) => x.title)).toEqual(['Alpha set A', 'Alpha set B']);
    expect(r.panels.kneeboard.entries().some((e) => e.body === 'Alpha printout 0')).toBe(true);
    expect(r.panels.checklist.isTicked('a1')).toBe(true);
    expect(r.panels.comms.lastMessages(10).length).toBeGreaterThan(0);
    const oldSession = r.app.session;
    const audioBefore = r.audio.resets;

    r.app.restart();
    expect(r.app.state).toBe('flightSelect');
    r.app.chooseFlight('fx-b');
    expect(r.app.state).toBe('modeSelect');
    r.app.chooseAuto();
    expect(r.app.state).toBe('briefing'); // the practice step was done in this page session

    // the session, the panels, the displays and the debrief source are B's
    expect(r.app.session).not.toBe(oldSession);
    expect(r.app.session.engine.status.run).toBe('idle');
    expect(r.app.scenario.id).toBe('fxb-v0');
    expect(r.app.activeFlight.id).toBe('fx-b');
    expect(r.panels.scenarios.map((s) => s.id)).toEqual(['fxb-v0']);
    expect(r.displays.names).toEqual({ dep: 'Bravo departure', dest: 'Bravo destination' });
    expect(r.audio.resets).toBeGreaterThan(audioBefore); // the audio queue was cleared
    // nothing of A is visible anywhere
    expect(everyText(r).filter((t) => /alpha/i.test(t))).toEqual([]);
    expect(r.panels.comms.lastMessages(10)).toEqual([]);
    expect(r.panels.comms.pendingCards()).toEqual([]);
    expect(r.panels.kneeboard.entries().map((e) => e.id)).toEqual(['brief-1']);
    expect(r.panels.kneeboard.entries()[0].body).toBe('Bravo briefing, variation 0.');
    expect(r.panels.checklist.current()).toBeNull();
    expect(r.panels.checklist.isTicked('a1')).toBe(false);
    expect(r.panels.kneeboard.hintText()).toBeNull();
    expect(r.panels.route.rows().map((x) => x.name)).toEqual(['Bravo departure', 'Bravo destination']);
    expect(r.app.crewCaption.current(performance.now())).toBeNull();
    expect(r.app.results().original).toEqual([]);

    // flying B: cues, rows and results are all B's
    r.app.begin();
    r.tick(6);
    expect(r.panels.comms.lastMessages(10).map((m) => m.text)).toEqual(['Bravo message 0']);
    expect(r.panels.kneeboard.entries().some((e) => e.body === 'Bravo printout 0')).toBe(true);
    r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    r.act({ kind: 'control', controlId: 'lights.landing', value: true });
    r.tick(1);
    r.act({ kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(r.app.state).toBe('debrief');
    expect(setIdsOf(r)).toEqual(['fxb-es-a', 'fxb-es-b']);
    expect(r.app.debrief().map((x) => x.title)).toEqual(['Bravo set A', 'Bravo set B']);
    expect(r.app.results().original.map((g) => g.eventSetId)).toEqual(['fxb-es-a', 'fxb-es-b']);
    expect(Object.keys(r.app.results().reviews)).toEqual(['fxb-es-a', 'fxb-es-b']);
    expect(r.app.review('fxa-es-a')).toBeNull();
    expect(r.app.review('fxb-es-a')?.attempt).toBe('first');
    // the old session's restarted engine never ran: it holds no action of B's run
    expect(oldSession.engine.actionsFor('fxa-es-a')).toEqual([]);
    expect(oldSession.engine.actionsFor('fxb-es-a')).toEqual([]);
  });

  it('B back to A: a different variation of the same flight swaps too, and the held start cues of the restart are dropped', () => {
    const r = mkFlightRig({ rnd: [0.9], stored: { 'fx-a': 0 } });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyWithResidue(r, 'guided'); // variation 0
    r.app.restart();
    const cuesAtRestart = r.panels.cues.length;
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto(); // draws: not 0 -> variation 2 (0.9 of [1, 2])
    expect(r.app.variation).toBe(2);
    expect(r.panels.cues.length).toBe(cuesAtRestart); // the old engine's start cues were held, never shown
    expect(r.panels.scenarios.map((s) => s.id)).toEqual(['fxa-v2']);
    expect(everyText(r).filter((t) => /message 0|printout 0|variation 0/.test(t))).toEqual([]);
    expect(r.app.guided).toBe(false);
    r.app.begin();
    r.tick(6);
    expect(r.panels.comms.lastMessages(10).map((m) => m.text)).toEqual(['Alpha message 2']);
    expect(r.panels.kneeboard.entries().some((e) => e.body === 'Alpha printout 2')).toBe(true);
    expect(r.stored.get('fx-a')).toBe(2);
  });

  it('restarting into the same flight and variation keeps the scenario and does not swap', () => {
    const r = mkFlightRig();
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyWithResidue(r, 'guided');
    const session = r.app.session;
    r.app.restart();
    expect(r.app.state).toBe('flightSelect');
    r.app.chooseFlight('fx-a');
    r.app.chooseGuided();
    expect(r.app.session).toBe(session);
    expect(r.panels.scenarios).toEqual([]);
    expect(r.panels.comms.lastMessages(10)).toEqual([]);
    expect(r.panels.checklist.isTicked('a1')).toBe(false);
    r.app.begin(); // the restarted engine resumes and its held cues arrive
    r.tick(1);
    expect(r.panels.comms.lastMessages(10).map((m) => m.text)).toEqual(['Alpha message 0']);
    expect(r.app.guided).toBe(true);
  });

  it('actions reach the new engine only; the old engine records nothing after the swap', () => {
    const r = mkFlightRig({ rnd: [0] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyToDebrief(r);
    const old = r.app.session;
    r.app.restart();
    const oldEngine = old.engine; // the restarted engine of A: started, paused, waiting for BEGIN that will never reach it
    r.app.chooseFlight('fx-b');
    r.app.chooseAuto();
    r.app.begin();
    r.tick(1);
    r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    expect(r.app.session.engine.actionsFor('fxb-es-a').map((a) => a.body)).toContainEqual({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    expect(oldEngine.actionsFor('fxa-es-a')).toEqual([]);
    expect(oldEngine.actionsFor('fxb-es-a')).toEqual([]);
  });

  it('the swap itself does not leave a stale ended listener: the old session ending cannot move the flow', () => {
    const r = mkFlightRig({ rnd: [0] });
    r.app.continue();
    r.app.chooseFlight('fx-a');
    flyToDebrief(r);
    const old = r.app.session;
    r.app.restart();
    r.app.chooseFlight('fx-b');
    r.app.chooseAuto();
    r.app.begin();
    r.tick(1);
    expect(r.app.state).toBe('running'); // a stale listener would end THIS flight (the reducer ignores 'ended' in the briefing)
    old.engine.resume();
    old.engine.tick(1);
    old.engine.dispatch({ kind: 'control', controlId: 'route.destination', value: 'dep' }); // the fixture's end condition
    expect(old.engine.status.run, 'the old engine really did end').toBe('ended');
    expect(r.app.state).toBe('running');
    expect(r.app.session).not.toBe(old);
  });

  it('flying flight B alone: GUIDED is not offered, practise alone works, and a second restart into A shows A again', () => {
    const r = mkFlightRig({ rnd: [0, 0.5] });
    r.app.continue();
    r.app.chooseFlight('fx-b');
    r.app.chooseGuided();
    expect(r.app.state).toBe('modeSelect');
    flyWithResidue(r); // chooseAuto, then fly
    expect(r.app.scenario.id).toBe('fxb-v0');
    r.app.restart();
    r.app.chooseFlight('fx-a');
    r.app.chooseAuto();
    expect(r.app.activeFlight.id).toBe('fx-a');
    expect(everyText(r).filter((t) => /bravo/i.test(t))).toEqual([]);
    expect(r.displays.names).toEqual({ dep: 'Alpha departure', dest: 'Alpha destination' });
    expect(r.panels.comms.lastMessages(10)).toEqual([]);
  });
});
