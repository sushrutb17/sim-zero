// Task 11: app flow reducer, Auto wiring (TrainerApp + autoRunner) and debrief model.
// Pure / headless: a real EventBus and TrainingSession on the real scenario, fake panels/displays/controls.
import { describe, expect, it } from 'vitest';
import type { AircraftState, ControlId } from '../../src/contracts/aircraft';
import { REASON_LABELS, type PilotAction, type Stamped, type WorldCue } from '../../src/contracts/events';
import { EventBus } from '../../src/bus/eventBus';
import { parseScenario } from '../../src/contracts/scenario';
import { miniScenario } from '../fixtures/mini-scenario';
import { singleSource } from '../../src/scenarios/single-source';
import { flowReducer, type FlowState } from '../../src/app/flow';
import { chooseBriefingMode, requestWithFallback, switchToCockpit } from '../../src/app/briefingMode';
import { TrainerApp } from '../../src/app/controller';
import { debriefRows } from '../../src/app/debriefModel';
import { CommsModel, ChecklistModel, KneeboardModel } from '../../src/xr/panels/panelModel';

const DT = 0.1;

function mkApp() {
  const bus = new EventBus();
  const log: string[] = [];
  const cues: Stamped<WorldCue>[] = [];
  const busCues: Stamped<WorldCue>[] = [];
  bus.onCue((c) => busCues.push(c));
  let pauseCb: (() => void) | undefined;
  const panels = {
    handleCue(c: Stamped<WorldCue>) {
      cues.push(c);
      this.comms.apply(c.body);
      if (c.body.kind === 'eventSet' && c.body.status === 'start') this.kneeboard.onEventSet(c.body.eventSetId);
      if (c.body.kind === 'eventSet') log.push(`cue:${c.body.eventSetId}:${c.body.status}`);
    },
    /** What the real route panel shows as selected (PanelsSystem binds it to AircraftState.destination). */
    routeSelected: undefined as string | undefined,
    setAircraft(s: AircraftState) {
      this.routeSelected = s.destination;
    },
    setScenario() {
      log.push('panels.setScenario');
    },
    reset() {
      log.push('panels.reset');
    },
    onPause(cb: () => void) {
      pauseCb = cb;
    },
    /** Same models the real panels use: their press paths are `model.x(...)` then `bus.emitAction`. */
    live: true,
    comms: new CommsModel(),
    checklist: new ChecklistModel(singleSource.checklists),
    kneeboard: new KneeboardModel(singleSource.briefing, singleSource.eventSets),
    setLive(b: boolean) {
      this.live = b;
      this.comms.live = b;
      this.checklist.live = b;
      this.kneeboard.live = b;
    },
  };
  const displays = {
    aircraft: undefined as AircraftState | undefined,
    setAircraft(s: AircraftState) {
      this.aircraft = s;
    },
    resetAlerts() {
      log.push('displays.resetAlerts');
    },
    names: {} as Record<string, string>,
    setAirportNames(m: Record<string, string>) {
      this.names = m;
    },
  };
  const written = new Map<ControlId, unknown>();
  const controls = new Map<ControlId, { setValue(v: unknown): void }>();
  for (const id of ['ap.hdg', 'ap.alt', 'ap.engage', 'ap.lateral', 'ap.vertical', 'baro.set', 'lights.landing', 'lights.strobe', 'elec.gen1', 'elec.gen2', 'elec.busTie'] as ControlId[])
    controls.set(id, { setValue: (v) => written.set(id, v) });
  const app = new TrainerApp({ scenario: singleSource, bus, panels, displays, controls });
  /** A reply-card / hint press exactly as the real views do it. */
  const pressCard = (messageId: string, cardId: string) => {
    const a = panels.comms.choose(messageId, cardId);
    if (a) bus.emitAction(a);
  };
  const pressHint = () => {
    const a = panels.kneeboard.pressHint();
    if (a) bus.emitAction(a);
  };

  const act = (a: PilotAction) => bus.emitAction(a);
  const ctl = (controlId: ControlId, value: number | boolean | string) => act({ kind: 'control', controlId, value });
  const reply = (messageId: string, cardId: string) => act({ kind: 'reply', messageId, cardId });
  const item = (checklistId: string, itemId: string) => act({ kind: 'checklistItem', checklistId, itemId });
  const sent = (id: string) => cues.some((c) => (c.body.kind === 'message' || c.body.kind === 'alert') && c.body.id === id);
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9; t += DT) app.frame(DT);
  };
  const until = (what: string, pred: () => boolean, maxSec = 240) => {
    let t = 0;
    while (!pred()) {
      if (t > maxSec) throw new Error(`timed out waiting for ${what} (flow ${app.state}, ${JSON.stringify(app.session.engine.status)})`);
      app.frame(DT);
      t += DT;
    }
  };
  const waitFor = (id: string) => until(`cue ${id}`, () => sent(id));
  const inSet = (id: string) => until(`set ${id}`, () => app.session.engine.status.eventSetId === id);
  return { pressCard, pressHint, app, bus, log, cues, busCues, panels, displays, written, act, ctl, reply, item, tick, until, waitFor, inSet, pause: () => pauseCb?.() };
}
type Rig = ReturnType<typeof mkApp>;

function toRunning(r: Rig) {
  r.app.continue();
  r.app.chooseAuto();
  r.ctl('practice.toggle', true);
  r.app.begin();
}

function es1(r: Rig) {
  r.tick(2);
  r.reply('twr-hold', 'hold-readback');
  r.ctl('baro.set', 1004);
  r.ctl('ap.hdg', 90);
  r.ctl('ap.alt', 4000);
  r.ctl('lights.landing', true);
  r.ctl('lights.strobe', true);
  r.tick(2);
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) r.item('beforeTakeoff', id);
}
function es2(r: Rig) {
  r.tick(2);
  r.reply('twr-takeoff', 'to-readback');
  r.waitFor('dep-climb');
  r.reply('dep-climb', 'dev-left');
  r.ctl('ap.engage', true);
  r.ctl('ap.alt', 12000);
  r.ctl('ap.vertical', 'climb');
  r.ctl('ap.hdg', 60);
}
function es3(r: Rig) {
  r.tick(1);
  r.reply('dep-handoff', 'ho-readback');
  r.waitFor('gen1-fail');
  r.tick(2);
  r.act({ kind: 'alertAck', alertId: 'gen1-fail' });
  r.tick(1);
  r.item('genFail', 'gf-identify');
  r.ctl('elec.gen1', false);
  r.item('genFail', 'gf-gen1-off');
  r.ctl('elec.busTie', true);
  r.item('genFail', 'gf-bustie');
  r.item('genFail', 'gf-cabin');
  r.item('genFail', 'gf-review');
  r.waitFor('cab-lights');
  r.reply('cab-lights', 'cab-standby');
  r.waitFor('ctr-query');
  r.reply('ctr-query', 'ctr-report');
}
function es4Return(r: Rig) {
  r.waitFor('ctr-intentions');
  r.tick(3);
  r.reply('ctr-intentions', 'dec-return');
  r.tick(3);
  r.ctl('route.destination', 'dep');
  r.tick(2);
  r.ctl('pa.cabin', true);
  r.waitFor('pa-cabin');
  r.reply('pa-cabin', 'pa-clear');
}
function happyToDebrief(r: Rig) {
  toRunning(r);
  playAll(r);
}
function happyGuided(r: Rig) {
  r.app.continue();
  r.app.chooseGuided();
  r.ctl('practice.toggle', true);
  r.app.begin();
  playAll(r);
}
function playAll(r: Rig) {
  es1(r);
  r.inSet('es2-takeoff-climb');
  es2(r);
  r.inSet('es3-gen-failure');
  es3(r);
  r.inSet('es4-decision');
  es4Return(r);
}

describe('flowReducer', () => {
  it('walks the happy path and ignores invalid events', () => {
    let s: FlowState = 'welcome';
    expect(flowReducer(s, { type: 'begin' })).toBe('welcome');
    s = flowReducer(s, { type: 'continue', skipFlightSelect: true }); // one flight registered: today's route
    expect(s).toBe('modeSelect');
    expect(flowReducer(s, { type: 'chooseManual' })).toBe('modeSelect'); // Manual arrives with Task 14
    s = flowReducer(s, { type: 'chooseAuto' });
    expect(s).toBe('practice');
    s = flowReducer(s, { type: 'practiceDone' });
    expect(s).toBe('briefing');
    expect(flowReducer(s, { type: 'pause' })).toBe('briefing');
    s = flowReducer(s, { type: 'begin' });
    expect(s).toBe('running');
    expect(flowReducer(s, { type: 'pause' })).toBe('paused');
    expect(flowReducer('paused', { type: 'resume', to: 'redo' })).toBe('redo');
    s = flowReducer(s, { type: 'ended' });
    expect(s).toBe('debrief');
    expect(flowReducer(s, { type: 'redo', eventSetId: 'x' })).toBe('redo');
    expect(flowReducer('redo', { type: 'ended' })).toBe('debrief');
    expect(flowReducer(s, { type: 'restart', skipFlightSelect: true })).toBe('modeSelect');
    s = flowReducer(s, { type: 'finish' });
    expect(s).toBe('finished');
    expect(flowReducer(s, { type: 'restart', skipFlightSelect: true })).toBe('modeSelect');
    expect(flowReducer(s, { type: 'redo', eventSetId: 'x' })).toBe('finished');
  });
});

describe('flowReducer flight picker (T41)', () => {
  it('welcome -> flightSelect -> modeSelect when several flights are registered', () => {
    let s: FlowState = flowReducer('welcome', { type: 'continue' });
    expect(s).toBe('flightSelect');
    s = flowReducer(s, { type: 'chooseFlight' });
    expect(s).toBe('modeSelect');
  });

  it('continue and restart skip the picker when skipFlightSelect is set (one flight)', () => {
    expect(flowReducer('welcome', { type: 'continue', skipFlightSelect: true })).toBe('modeSelect');
    expect(flowReducer('welcome', { type: 'continue', skipFlightSelect: false })).toBe('flightSelect');
    for (const from of ['debrief', 'finished'] as const) {
      expect(flowReducer(from, { type: 'restart', skipFlightSelect: true })).toBe('modeSelect');
      expect(flowReducer(from, { type: 'restart', skipFlightSelect: false })).toBe('flightSelect');
      expect(flowReducer(from, { type: 'restart' })).toBe('flightSelect');
    }
  });

  it('chooseFlight only works on the picker; the mode events need the mode screen', () => {
    for (const s of ['welcome', 'modeSelect', 'practice', 'briefing', 'running', 'paused', 'debrief', 'redo', 'finished'] as const)
      expect(flowReducer(s, { type: 'chooseFlight' }), s).toBe(s);
    for (const ev of [{ type: 'chooseAuto' }, { type: 'chooseGuided' }, { type: 'begin' }, { type: 'pause' }, { type: 'restart' }, { type: 'finish' }, { type: 'ended' }] as const)
      expect(flowReducer('flightSelect', ev), ev.type).toBe('flightSelect');
    expect(flowReducer('flightSelect', { type: 'continue' })).toBe('flightSelect');
    expect(flowReducer('flightSelect', { type: 'resume', to: 'running' })).toBe('flightSelect');
  });

  it('restart is ignored outside debrief and finished, picker or not', () => {
    for (const s of ['welcome', 'flightSelect', 'modeSelect', 'practice', 'briefing', 'running', 'paused', 'redo'] as const)
      expect(flowReducer(s, { type: 'restart', skipFlightSelect: false }), s).toBe(s);
  });
});

describe('flowReducer abandon (T51: RESTART on the Paused screen)', () => {
  it('paused -> flight picker, or the mode screen when only one flight is registered', () => {
    expect(flowReducer('paused', { type: 'abandon' })).toBe('flightSelect');
    expect(flowReducer('paused', { type: 'abandon', skipFlightSelect: false })).toBe('flightSelect');
    expect(flowReducer('paused', { type: 'abandon', skipFlightSelect: true })).toBe('modeSelect');
  });

  it('is ignored everywhere but the Paused screen (a run in progress, the debrief and the menus are untouched)', () => {
    for (const s of ['welcome', 'flightSelect', 'modeSelect', 'practice', 'briefing', 'running', 'debrief', 'redo', 'finished'] as const)
      expect(flowReducer(s, { type: 'abandon', skipFlightSelect: false }), s).toBe(s);
  });

  it('restart keeps its meaning: it still does nothing from paused', () => {
    expect(flowReducer('paused', { type: 'restart' })).toBe('paused');
  });
});

describe('flowReducer guided mode', () => {
  it('chooseGuided goes to practice, or to briefing when the practice step was already done', () => {
    expect(flowReducer('modeSelect', { type: 'chooseGuided' })).toBe('practice');
    expect(flowReducer('modeSelect', { type: 'chooseGuided', skipPractice: true })).toBe('briefing');
    expect(flowReducer('modeSelect', { type: 'chooseAuto', skipPractice: true })).toBe('briefing');
    expect(flowReducer('welcome', { type: 'chooseGuided', skipPractice: true })).toBe('welcome');
  });
});

describe('TrainerApp (Auto wiring)', () => {
  it('full happy flow welcome→…→finished', () => {
    const r = mkApp();
    expect(r.app.state).toBe('welcome');
    expect(r.displays.names).toEqual({ dep: 'Port Aldane', alt1: 'Kestry Field', alt2: 'Isle Morrow', dest: 'Vantreth' });
    // boot: controls show the scenario's initial aircraft, not the Task 8 placeholders
    expect(r.written.get('baro.set')).toBe(1009);
    expect(r.written.get('ap.hdg')).toBe(0);
    expect(r.written.get('elec.busTie')).toBe(false);
    // every bound control reads the scenario's initialAircraft before the first frame of the welcome screen
    const ia = singleSource.initialAircraft;
    expect(r.written.get('ap.alt')).toBe(ia.ap.alt);
    expect(r.written.get('ap.engage')).toBe(ia.ap.engaged);
    expect(r.written.get('lights.landing')).toBe(ia.lights.landing);
    expect(r.written.get('elec.gen1')).toBe(ia.elec.gen1.switchOn);
    expect(r.panels.routeSelected).toBe(ia.destination);
    r.app.continue();
    expect(r.app.state).toBe('modeSelect');
    r.app.chooseAuto();
    expect(r.app.state).toBe('practice');
    r.ctl('practice.toggle', true);
    expect(r.app.state).toBe('briefing');
    expect(r.app.session.engine.status.run).toBe('idle');
    r.app.begin();
    expect(r.app.state).toBe('running');
    expect(r.app.session.engine.status.eventSetId).toBe('es1-before-takeoff');
    es1(r);
    r.inSet('es2-takeoff-climb');
    es2(r);
    r.inSet('es3-gen-failure');
    es3(r);
    r.inSet('es4-decision');
    es4Return(r);
    expect(r.app.state).toBe('debrief');
    expect(r.app.session.engine.status.endReason).toBe('diversionSetUp');
    const g = r.app.session.results().original;
    expect(g.map((x) => x.grade)).toEqual([4, 4, 4, 4]);
    // live state reached the cockpit controls and the displays
    expect(r.written.get('baro.set')).toBe(1004);
    expect(r.written.get('elec.busTie')).toBe(true);
    expect(r.displays.aircraft?.destination).toBe('dep');
    // alerts travel on the bus to the displays
    expect(r.busCues.some((c) => c.body.kind === 'alert' && c.body.id === 'gen1-fail')).toBe(true);
    r.app.finish();
    expect(r.app.state).toBe('finished');
  });

  it('debrief redo goes to redo then debrief', () => {
    const r = mkApp();
    happyToDebrief(r);
    r.app.redo('es2-takeoff-climb');
    expect(r.app.state).toBe('redo');
    expect(r.app.session.engine.status.eventSetId).toBe('es2-takeoff-climb');
    es2(r);
    r.until('redo end', () => r.app.state === 'debrief');
    const res = r.app.session.results();
    expect(res.redo?.eventSetId).toBe('es2-takeoff-climb');
    expect(res.redo?.grade.grade).toBe(4);
    expect(res.original).toHaveLength(4);
    // a redo of an unknown set is refused and the debrief stays
    r.app.redo('nope');
    expect(r.app.state).toBe('debrief');
  });

  it('visibility blur pauses engine', () => {
    const r = mkApp();
    toRunning(r);
    r.tick(1);
    r.app.visibility('visible-blurred');
    expect(r.app.state).toBe('paused');
    const t0 = r.app.session.engine.status.tInSet;
    r.tick(3);
    expect(r.app.session.engine.status.tInSet).toBe(t0);
    // actions are not dispatched while paused
    r.ctl('baro.set', 1004);
    expect(r.app.session.engine.actionsFor('es1-before-takeoff')).toHaveLength(0);
    // becoming visible again does NOT resume: resume is by hand
    r.app.visibility('visible');
    expect(r.app.state).toBe('paused');
    r.app.visibility('hidden');
    expect(r.app.state).toBe('paused');
    r.app.resume();
    expect(r.app.state).toBe('running');
    r.tick(1);
    expect(r.app.session.engine.status.tInSet).toBeGreaterThan(t0);
    // the kneeboard Pause pad pauses too
    r.pause();
    expect(r.app.state).toBe('paused');
    r.app.resume();
    // leaving immersive mode pauses as well
    r.app.visibility('non-immersive');
    expect(r.app.state).toBe('paused');
  });

  it('restart from debrief returns to the mode screen with a fresh session', () => {
    const r = mkApp();
    happyToDebrief(r);
    const before = r.cues.length;
    r.app.restart();
    expect(r.app.state).toBe('modeSelect');
    r.app.chooseAuto(); // the practice step was already done in this page session
    expect(r.app.state).toBe('briefing');
    expect(r.app.session.results().original).toEqual([]);
    expect(r.app.session.engine.status.eventSetId).toBe('es1-before-takeoff');
    // nothing reaches the panels and the clock does not run until Begin
    r.tick(5);
    expect(r.cues.length).toBe(before);
    expect(r.app.session.engine.status.tInSet).toBe(0);
    expect(r.written.get('baro.set')).toBe(1009);
    // the route panel shows the scenario's destination again (the run above had changed it to 'dep')
    expect(r.panels.routeSelected).toBe(singleSource.initialAircraft.destination);
    r.app.begin();
    expect(r.app.state).toBe('running');
    const newCues = r.cues.slice(before);
    expect(newCues[0].body).toEqual({ kind: 'eventSet', eventSetId: 'es1-before-takeoff', status: 'start' });
    r.tick(1);
    expect(r.app.session.engine.status.tInSet).toBeGreaterThan(0);
    // the second run is playable to the end
    es1(r);
    r.inSet('es2-takeoff-climb');
  });

  it('actions are ignored outside running/redo', () => {
    const r = mkApp();
    r.app.continue();
    r.ctl('baro.set', 1004); // modeSelect
    r.app.chooseAuto();
    r.ctl('lights.landing', true); // practice: not the practice switch, stays in practice
    expect(r.app.state).toBe('practice');
    r.ctl('practice.toggle', true);
    r.ctl('baro.set', 1004); // briefing
    r.tick(0.5);
    r.app.begin();
    expect(r.app.session.engine.actionsFor('es1-before-takeoff')).toEqual([]);
    expect(r.app.session.engine.state.baroHpa).toBe(1009);
    // a fingertip overshooting BEGIN into the glareshield does not count (engage grace)
    r.ctl('lights.landing', true);
    r.tick(0.2);
    expect(r.app.session.engine.actionsFor('es1-before-takeoff')).toEqual([]);
    expect(r.written.get('lights.landing')).toBe(false);
    r.tick(0.3);
    // the pressed control is put back to the aircraft value on the next frame
    r.written.delete('baro.set');
    r.ctl('baro.set', 1004);
    r.app.pause();
    r.ctl('baro.set', 1003);
    r.tick(0.2);
    expect(r.written.get('baro.set')).toBe(1004);
    r.app.resume();
    r.tick(0.5);
    expect(r.app.session.engine.actionsFor('es1-before-takeoff').map((a) => a.body)).toEqual([{ kind: 'control', controlId: 'baro.set', value: 1004 }]);
  });

  it('restart resets panels and alerts before start cues', () => {
    const r = mkApp();
    happyToDebrief(r);
    r.log.length = 0;
    r.app.redo('es3-gen-failure');
    expect(r.log.slice(0, 3)).toEqual(['panels.reset', 'displays.resetAlerts', 'cue:es3-gen-failure:start']);
    es3(r);
    r.until('redo end', () => r.app.state === 'debrief');
    r.log.length = 0;
    r.app.restart();
    r.app.chooseAuto();
    r.app.begin();
    expect(r.log.slice(0, 3)).toEqual(['panels.reset', 'displays.resetAlerts', 'cue:es1-before-takeoff:start']);
  });

  it('panel presses while paused, in the grace window or outside the run change nothing (fix round 1)', () => {
    const r = mkApp();
    r.app.continue();
    r.app.chooseAuto();
    r.ctl('practice.toggle', true);
    r.app.begin();
    // grace window right after Begin: not live yet
    expect(r.panels.live).toBe(false);
    r.tick(2);
    expect(r.panels.live).toBe(true);
    expect(r.panels.comms.pendingCards().map((c) => c.cardId)).toContain('hold-readback');
    // pause: poking the card or the hint must not consume them
    r.app.pause();
    expect(r.panels.live).toBe(false);
    r.pressCard('twr-hold', 'hold-readback');
    r.pressHint();
    expect(r.panels.comms.pendingCards().map((c) => c.cardId)).toContain('hold-readback');
    expect(r.panels.kneeboard.hintText()).toBeNull();
    r.app.resume();
    expect(r.panels.live).toBe(false); // grace window after Resume
    r.pressCard('twr-hold', 'hold-readback');
    expect(r.panels.comms.pendingCards().map((c) => c.cardId)).toContain('hold-readback');
    r.tick(0.5);
    expect(r.panels.live).toBe(true);
    // the card is still pending and answering it now reaches the engine exactly once; no hint was recorded
    r.pressCard('twr-hold', 'hold-readback');
    r.pressCard('twr-hold', 'hold-readback');
    const acts = r.app.session.engine.actionsFor('es1-before-takeoff').map((a) => a.body);
    expect(acts.filter((a) => a.kind === 'reply')).toEqual([{ kind: 'reply', messageId: 'twr-hold', cardId: 'hold-readback' }]);
    expect(acts.some((a) => a.kind === 'hint')).toBe(false);
    // finish the set; the debrief and the finished screens are not live either
    es1(r);
    r.inSet('es2-takeoff-climb');
    es2(r);
    r.inSet('es3-gen-failure');
    es3(r);
    r.inSet('es4-decision');
    es4Return(r);
    expect(r.app.state).toBe('debrief');
    expect(r.panels.live).toBe(false);
    expect(r.app.session.results().original[0].hintUsed).toBe(false);
  });

  it('debrief shows original and redo side by side', () => {
    const r = mkApp();
    toRunning(r);
    // a poor first ES1: nothing set, checklist ticked straight through -> low grade with reasons
    r.tick(1);
    for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) r.item('beforeTakeoff', id);
    r.inSet('es2-takeoff-climb');
    es2(r);
    r.inSet('es3-gen-failure');
    es3(r);
    r.inSet('es4-decision');
    es4Return(r);
    expect(r.app.state).toBe('debrief');
    const first = r.app.debrief();
    expect(first).toHaveLength(4);
    expect(first[0].grade).toBeLessThan(4);
    expect(first[0].redoGrade).toBeUndefined();
    expect(first[0].reasons.length).toBeGreaterThan(0);
    expect(first[0].reasons.length).toBeLessThanOrEqual(3);
    for (const x of first[0].reasons) expect(Object.values(REASON_LABELS)).toContain(x.label);
    r.app.redo('es1-before-takeoff');
    es1(r);
    r.until('redo end', () => r.app.state === 'debrief');
    const rows = r.app.debrief();
    expect(rows[0]).toMatchObject({ eventSetId: 'es1-before-takeoff', title: 'Before takeoff', grade: first[0].grade, redoGrade: 4 });
    expect(rows[0].technical).toBe(singleSource.eventSets[0].technical);
    expect(rows[0].crm).toBe(singleSource.eventSets[0].crm);
    for (const row of rows.slice(1)) expect(row.redoGrade).toBeUndefined();
    // the model renders session.results() only
    expect(debriefRows(singleSource, r.app.session.results())).toEqual(rows);
  });
});

describe('TrainerApp guided flight', () => {
  function toBegin(r: Rig, guided: boolean) {
    r.app.continue();
    if (guided) r.app.chooseGuided();
    else r.app.chooseAuto();
    r.ctl('practice.toggle', true);
    r.app.begin();
  }

  it('a guided flight runs at patience 2', () => {
    const g = mkApp();
    toBegin(g, true);
    expect(g.app.guided).toBe(true);
    g.tick(10);
    expect(g.app.session.engine.status.tInSet).toBeCloseTo(5, 0);
    const a = mkApp();
    toBegin(a, false);
    expect(a.app.guided).toBe(false);
    a.tick(10);
    expect(a.app.session.engine.status.tInSet).toBeCloseTo(10, 0);
  });

  it('guided, restart, PRACTISE ALONE: patience back to 1 and guide() is null', () => {
    const r = mkApp();
    happyGuided(r);
    expect(r.app.guided).toBe(true); // the debrief still sees the mode of the flight
    r.app.restart();
    expect(r.app.guided).toBe(true); // until the next choice
    r.app.chooseAuto();
    expect(r.app.guided).toBe(false);
    r.app.begin();
    const t0 = r.app.session.engine.status.tInSet;
    r.tick(4);
    expect(r.app.session.engine.status.tInSet - t0).toBeCloseTo(4, 0);
    expect(r.app.guide()).toBeNull();
  });

  /** A scenario with a two-step guide on each of the two sets, and a world in which every target exists. */
  const world = { cardPending: () => true, checklistItemOpen: () => true, alertUnacked: () => true };
  function guidedMini(timeLimitSec?: number) {
    const base = structuredClone(miniScenario);
    const [a, b] = base.eventSets;
    const sets = [
      {
        ...a,
        endWhen: timeLimitSec === undefined ? a.endWhen : { kind: 'any', of: [a.endWhen, { kind: 'atSec', sec: timeLimitSec }] },
        guide: [
          { id: 'a-1', where: 'Radio', text: 'Answer the call.', light: [{ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' }], doneWhen: { kind: 'action', match: { kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' } } },
          { id: 'a-2', where: 'Overhead', text: 'Landing lights on.', light: [{ kind: 'control', controlId: 'lights.landing', value: true }], doneWhen: { kind: 'state', path: 'lights.landing', op: 'eq', value: true } },
        ],
      },
      {
        ...b,
        guide: [
          { id: 'b-1', where: 'Panel', text: 'Check the generators.', light: [{ kind: 'control', controlId: 'elec.gen1', value: false }], doneWhen: { kind: 'action', match: { kind: 'control', controlId: 'elec.gen1', value: false } } },
          { id: 'b-2', where: 'Route', text: 'Set the diversion.', light: [{ kind: 'control', controlId: 'route.destination', value: 'dep' }], doneWhen: { kind: 'state', path: 'destination', op: 'eq', value: 'dep' } },
        ],
      },
    ];
    const scenario = parseScenario({ ...base, eventSets: sets });
    const bus = new EventBus();
    const app = new TrainerApp({
      scenario,
      bus,
      guideWorld: world,
      controls: new Map(),
      panels: { handleCue: () => {}, setScenario: () => {}, setAircraft: () => {}, setLive: () => {}, reset: () => {}, onPause: () => {} },
      displays: { setAircraft: () => {}, resetAlerts: () => {}, setAirportNames: () => {} },
    });
    const tick = (sec: number) => {
      for (let t = 0; t < sec - 1e-9; t += DT) app.frame(DT);
    };
    return { app, bus, tick };
  }

  it('guide() is null on every screen that is not running or redo, and while paused', () => {
    const { app, bus, tick } = guidedMini();
    expect(app.guide()).toBeNull(); // welcome
    app.continue();
    expect(app.guide()).toBeNull(); // modeSelect
    app.chooseGuided();
    expect(app.guide()).toBeNull(); // practice
    bus.emitAction({ kind: 'control', controlId: 'practice.toggle', value: true });
    expect(app.state).toBe('briefing');
    expect(app.guide()).toBeNull();
    app.begin();
    tick(1);
    expect(app.guide()?.stepId).toBe('a-1');
    app.pause();
    expect(app.guide()).toBeNull();
    app.resume();
    tick(1);
    expect(app.guide()?.stepId).toBe('a-1');
    bus.emitAction({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    bus.emitAction({ kind: 'control', controlId: 'lights.landing', value: true });
    tick(1);
    bus.emitAction({ kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(app.state).toBe('debrief');
    expect(app.guide()).toBeNull();
  });

  it('a redo of a guided flight is still guided at patience 2', () => {
    const { app, bus, tick } = guidedMini();
    app.continue();
    app.chooseGuided();
    bus.emitAction({ kind: 'control', controlId: 'practice.toggle', value: true });
    app.begin();
    tick(1);
    bus.emitAction({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    bus.emitAction({ kind: 'control', controlId: 'lights.landing', value: true });
    tick(1);
    bus.emitAction({ kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(app.state).toBe('debrief');
    app.redo('es-a');
    expect(app.state).toBe('redo');
    expect(app.guided).toBe(true);
    tick(4);
    expect(app.session.engine.status.tInSet).toBeCloseTo(2, 0);
    expect(app.guide()?.stepId).toBe('a-1');
  });

  it('when a set ends on its time limit the guide shows the first step of the next set', () => {
    const { app, bus, tick } = guidedMini(5);
    app.continue();
    app.chooseGuided();
    bus.emitAction({ kind: 'control', controlId: 'practice.toggle', value: true });
    app.begin();
    tick(2);
    expect(app.session.engine.status.eventSetId).toBe('es-a');
    expect(app.guide()?.stepId).toBe('a-1');
    tick(9); // 5 scenario seconds at patience 2 are 10 real seconds
    expect(app.session.engine.status.eventSetId).toBe('es-b');
    expect(app.guide()?.stepId).toBe('b-1');
  });

  it('guide() is null without a guideWorld, for a set without a guide, and never throws when idle', () => {
    const r = mkApp(); // single-source has no guide yet and the rig passes no guideWorld
    expect(r.app.guide()).toBeNull();
    toBegin(r, true);
    r.tick(1);
    expect(r.app.guide()).toBeNull();
  });
});

describe('debriefRows', () => {
  it('maps grades to rows with REASON_LABELS, hint markers and at most 3 reasons', () => {
    const rows = debriefRows(singleSource, {
      reviews: {},
      original: [
        { eventSetId: 'es1-before-takeoff', grade: 2, reasons: [{ category: 'procedures', text: 'A' }, { category: 'crm', text: 'B' }], hintUsed: true, source: 'auto' },
        { eventSetId: 'es2-takeoff-climb', grade: 4, reasons: [], hintUsed: false, source: 'auto' },
      ],
      redo: { eventSetId: 'es1-before-takeoff', review: { entries: [], elec: null }, grade: { eventSetId: 'es1-before-takeoff', grade: 3, reasons: [{ category: 'systems', text: 'C' }], hintUsed: false, source: 'auto' } },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: 'Before takeoff', grade: 2, hintUsed: true, redoGrade: 3, redoHintUsed: false });
    expect(rows[0].reasons).toEqual([
      { label: 'Procedures', text: 'A' },
      { label: 'Communication & CRM', text: 'B' },
    ]);
    expect(rows[0].redoReasons).toEqual([{ label: 'Systems knowledge', text: 'C' }]);
    expect(rows[1]).toMatchObject({ grade: 4, hintUsed: false, reasons: [] });
    expect(rows[1].redoGrade).toBeUndefined();
  });
});

describe('briefing mode (F29)', () => {
  it('chooseBriefingMode false → virtualRoom', () => {
    expect(chooseBriefingMode(false)).toBe('virtualRoom');
    expect(chooseBriefingMode(true)).toBe('passthrough');
  });

  it('AR session request failure falls back to immersive-vr', async () => {
    const asked: string[] = [];
    const request = async (mode: 'immersive-ar' | 'immersive-vr') => {
      asked.push(mode);
      if (mode === 'immersive-ar') throw new Error('NotSupportedError');
    };
    expect(await requestWithFallback('immersive-ar', request)).toBe('immersive-vr');
    expect(asked).toEqual(['immersive-ar', 'immersive-vr']);
    // the Begin switch: ending the AR session fails too -> still lands in immersive-vr, never a dead end
    asked.length = 0;
    const got = await switchToCockpit({
      end: async () => {
        throw new Error('end failed');
      },
      request,
    });
    expect(got).toBe('immersive-vr');
    expect(asked).toEqual(['immersive-vr']);
  });
});
