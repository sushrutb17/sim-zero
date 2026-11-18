// T41 test fixtures: a TWO-FLIGHT registry built from the small synthetic scenario, with fake panels that use the real panel
// models, so a swap test can look at exactly what a headset would show. No aviation content: placeholder text only.
import { vi } from 'vitest';
import { EventBus } from '../../src/bus/eventBus';
import type { AircraftState, ControlId } from '../../src/contracts/aircraft';
import type { PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import { parseScenario, type Scenario } from '../../src/contracts/scenario';
import { TrainerApp, type AppDeps } from '../../src/app/controller';
import type { FlightDef } from '../../src/scenarios/registry';
import { ChecklistModel, CommsModel, KneeboardModel, RouteModel } from '../../src/xr/panels/panelModel';
import { miniScenario } from '../fixtures/mini-scenario';

/** One variation of one fixture flight: the mini scenario with every rule id kept (the engine needs them) and the visible text changed. */
function variant(prefix: string, v: number, text: string): Scenario {
  const swap = (src: string, from: string, to: string) => src.split(from).join(to);
  let json = JSON.stringify(miniScenario);
  for (const [from, to] of [
    ['"es-a"', `"${prefix}-es-a"`],
    ['"es-b"', `"${prefix}-es-b"`],
    ['Set A', `${text} set A`],
    ['Set B', `${text} set B`],
    ['Message A1', `${text} message ${v}`],
    ['Placeholder briefing.', `${text} briefing, variation ${v}.`],
    ['Departure Placeholder', `${text} departure`],
    ['Destination Placeholder', `${text} destination`],
    ['Checklist A', `${text} checklist`],
    ['Placeholder data', `${text} printout ${v}`],
  ]) json = swap(json, from, to);
  const raw = JSON.parse(json);
  raw.id = `${prefix}-v${v}`;
  raw.title = `${text} ${v}`;
  raw.initialAircraft.comFreq = prefix === 'fxa' ? 'twr' : 'ctr';
  return parseScenario(raw);
}

const memo = new Map<string, Scenario>();
const build = (prefix: string, text: string) => (v: number): Scenario => {
  const key = `${prefix}:${v}`;
  let s = memo.get(key);
  if (!s) memo.set(key, (s = variant(prefix, v, text)));
  return s;
};

export const FLIGHT_A: FlightDef = { id: 'fx-a', title: 'Alpha flight', blurb: 'The first fixture', minutes: 10, guided: true, variations: 3, build: build('fxa', 'Alpha') };
/** No guide steps and a single variation: GUIDED FLIGHT is not offered. */
export const FLIGHT_B: FlightDef = { id: 'fx-b', title: 'Bravo flight', blurb: 'The second fixture', minutes: 8, guided: false, variations: 1, build: build('fxb', 'Bravo') };
export const FLIGHT_C: FlightDef = { id: 'fx-c', title: 'Charlie flight', blurb: 'The third fixture', minutes: 12, guided: true, variations: 2, build: build('fxc', 'Charlie') };
export const TWO_FLIGHTS: readonly FlightDef[] = [FLIGHT_A, FLIGHT_B];

export interface Rig {
  app: TrainerApp;
  bus: EventBus;
  panels: {
    /** Every `setScenario` argument, in order. */
    scenarios: Scenario[];
    comms: CommsModel;
    checklist: ChecklistModel;
    kneeboard: KneeboardModel;
    route: RouteModel;
    cues: Stamped<WorldCue>[];
  };
  displays: { names: Record<string, string>; resets: number; aircraft: AircraftState | undefined };
  audio: { resets: number };
  stored: Map<string, number>;
  draws: number[];
  tick(sec: number): void;
  act(a: PilotAction): void;
}

const DT = 0.1;

/** A TrainerApp over the fixture flights with fake panels, displays and audio. `rnd` is queued: each draw takes the next value (then 0). */
export function mkFlightRig(opts: { flights?: readonly FlightDef[]; rnd?: number[]; stored?: Record<string, number>; devOverride?: AppDeps['devOverride'] } = {}): Rig {
  const bus = new EventBus();
  const flights = opts.flights ?? TWO_FLIGHTS;
  const initial = flights[0].build(0);
  const panels: Rig['panels'] = {
    scenarios: [],
    comms: new CommsModel(),
    checklist: new ChecklistModel(initial.checklists),
    kneeboard: new KneeboardModel(initial.briefing, initial.eventSets),
    route: new RouteModel(initial.airports, initial.initialAircraft.destination),
    cues: [],
  };
  const displays: Rig['displays'] = { names: {}, resets: 0, aircraft: undefined };
  const audio = { resets: 0 };
  const stored = new Map<string, number>(Object.entries(opts.stored ?? {}));
  const draws: number[] = [];
  const queue = [...(opts.rnd ?? [])];
  const controls = new Map<ControlId, { setValue(v: unknown): void }>();
  for (const id of ['ap.hdg', 'ap.alt', 'ap.engage', 'ap.lateral', 'ap.vertical', 'baro.set', 'lights.landing', 'lights.strobe', 'elec.gen1', 'elec.gen2', 'elec.busTie'] as ControlId[]) controls.set(id, { setValue: () => {} });
  const app = new TrainerApp({
    flights,
    bus,
    controls,
    rnd: () => {
      const r = queue.shift() ?? 0;
      draws.push(r);
      return r;
    },
    loadLastVariation: (id) => stored.get(id) ?? null,
    saveLastVariation: (id, v) => void stored.set(id, v),
    devOverride: opts.devOverride,
    audio: { unlock: vi.fn(async () => {}), playMessage: vi.fn(), playSfx: vi.fn(), setWarning: vi.fn(), setPaused: vi.fn(), setAmbient: vi.fn(), reset: () => void audio.resets++, endRun: vi.fn(), dispose: vi.fn() },
    panels: {
      handleCue(c: Stamped<WorldCue>) {
        panels.cues.push(c);
        panels.comms.apply(c.body);
        if (c.body.kind === 'printout') panels.kneeboard.addPrintout(c.body.id, c.body.title, c.body.body);
        if (c.body.kind === 'checklistAvailable') panels.checklist.open(c.body.checklistId);
        if (c.body.kind === 'eventSet' && c.body.status === 'start') panels.kneeboard.onEventSet(c.body.eventSetId);
      },
      /** Same as the real facade: every model takes the new scenario and forgets the old one. */
      setScenario(s: Scenario) {
        panels.scenarios.push(s);
        panels.comms.reset();
        panels.checklist.setDefs(s.checklists);
        panels.kneeboard.setScenario(s.briefing, s.eventSets);
        panels.route.setAirports(s.airports, s.initialAircraft.destination);
      },
      setAircraft: () => {},
      reset() {
        panels.comms.reset();
        panels.checklist.reset();
        panels.kneeboard.reset();
      },
      onPause: () => {},
      setLive(b: boolean) {
        panels.comms.live = b;
        panels.checklist.live = b;
        panels.kneeboard.live = b;
        panels.route.live = b;
      },
    },
    displays: {
      setAircraft(s: AircraftState) {
        displays.aircraft = s;
      },
      resetAlerts: () => void displays.resets++,
      setAirportNames(m: Record<string, string>) {
        displays.names = m;
      },
    },
  });
  return {
    app,
    bus,
    panels,
    displays,
    audio,
    stored,
    draws,
    tick(sec) {
      for (let t = 0; t < sec - 1e-9; t += DT) app.frame(DT);
    },
    act: (a) => bus.emitAction(a),
  };
}

/** Choose the mode and fly the active fixture scenario to the debrief with the shortest legal run. */
export function flyToDebrief(r: Rig, mode: 'auto' | 'guided' = 'auto'): void {
  if (mode === 'guided') r.app.chooseGuided();
  else r.app.chooseAuto();
  if (r.app.state === 'practice') r.act({ kind: 'control', controlId: 'practice.toggle', value: true });
  r.app.begin();
  r.tick(1);
  r.act({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
  r.act({ kind: 'control', controlId: 'lights.landing', value: true });
  r.tick(1);
  r.act({ kind: 'control', controlId: 'route.destination', value: 'dep' });
  if (r.app.state !== 'debrief') throw new Error(`expected the debrief, flow is ${r.app.state}`);
}
