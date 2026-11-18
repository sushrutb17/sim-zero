/**
 * TrainerApp (Task 11): owns the flow state, the TrainingSession and the Auto wiring. No IWSDK imports: index.ts
 * hands it the real panels / displays / cockpit controls, the tests hand it fakes.
 *
 * Per frame (AppFlowSystem): while running/redo the engine ticks (dt clamped to 0.1 s), then the aircraft state goes
 * to the displays, the panels and every cockpit control. Outside running/redo the state is pushed only when something
 * changed it (boot, restart, redo, a press that must be put back).
 */
import type { EventBus } from '../bus/eventBus';
import type { AircraftState, ControlId } from '../contracts/aircraft';
import type { Stamped, WorldCue } from '../contracts/events';
import type { Scenario } from '../contracts/scenario';
import { TrainingSession, type SessionResults } from '../engine/session';
import type { SetReview } from '../engine/timeline';
import type { ActiveAlert } from '../xr/displays/alerts';
import type { TrainerAudio } from '../xr/audio';
import { CrewCaption } from './crewCaption';
import { currentGuide, type GuideView, type GuideWorld } from './guide';
import { startAuto, type AutoRunner } from './autoRunner';
import { ControlSync, type SettableControl } from './controlSync';
import { debriefRows, type DebriefRow } from './debriefModel';
import { flowReducer, isLive, type FlowEvent, type FlowState } from './flow';
import { loadLastVariation, saveLastVariation } from './flightPref';
import { startingPoint, type FlightOverride } from './flightOverride';
import { pickVariation, type FlightDef } from '../scenarios/registry';

export const MAX_DT_SEC = 0.1;
/**
 * Live seconds after Begin / Redo / Resume during which cockpit presses are not dispatched. The trainer screens float
 * a few centimetres in front of the glareshield controls, so a fingertip that overshoots the button can touch a
 * control behind it; that press must not count in the run it just started.
 */
export const ENGAGE_GRACE_SEC = 0.35;

export interface AppPanels {
  handleCue(cue: Stamped<WorldCue>): void;
  /** A different flight was chosen (T41): rebuild the checklist, route and kneeboard from it, clear every message and take its radio frequency. */
  setScenario(s: Scenario): void;
  setAircraft(s: AircraftState): void;
  reset(): void;
  onPause(cb: () => void): void;
  /**
   * False whenever the engine will not take an action (flow not running/redo, or inside the engage grace window): the
   * panels then ignore reply, checklist, hint, route and PA presses (no model change, no action). Page browsing and
   * Pause stay usable. Driven by the same predicate that gates `engine.dispatch`.
   */
  setLive(live: boolean): void;
}

export interface AppDisplays {
  /** Optional for headless consumers. Real displays gate ACK before mutating alert state. */
  setLive?(live: boolean): void;
  setAircraft(s: AircraftState): void;
  resetAlerts(list?: readonly ActiveAlert[]): void;
  setAirportNames(map: Record<string, string>): void;
}

export interface AppDeps {
  /**
   * The scenario the app starts with. Optional: it defaults to the first flight's baseline (or the dev override's flight and
   * variation). Headless callers that fly one fixed scenario pass it and no `flights`: it becomes the only flight, so there
   * is no picker.
   */
  scenario?: Scenario;
  /** The flights a user can choose. Defaults to the one flight built around `scenario`. Fewer than two flights: no picker. */
  flights?: readonly FlightDef[];
  /** Random source for the variation draw (default Math.random); tests inject it. */
  rnd?: () => number;
  /** The variation flown last in a flight, and where to remember it (default: localStorage, guarded). */
  loadLastVariation?: (flightId: string) => number | null;
  saveLastVariation?: (flightId: string, variation: number) => void;
  /** Dev-only `?flight=<id>&variation=<n>`: the app opens in that flight, and the variation is pinned for every draw. */
  devOverride?: FlightOverride;
  nowMs?: () => number;
  /** Optional so the scenario/controller can still run headless or without browser audio. */
  audio?: TrainerAudio;
  bus: EventBus;
  panels: AppPanels;
  displays: AppDisplays;
  controls: ReadonlyMap<ControlId, SettableControl>;
  /** What exists on screen right now, for the guided-flight tracker. Optional: headless callers may omit it. */
  guideWorld?: GuideWorld;
}

export class TrainerApp {
  readonly crewCaption = new CrewCaption();
  /** The flights on offer, in picker order. */
  readonly flights: readonly FlightDef[];
  /** The active session. A plain field (not a getter): it is replaced when another flight or variation is chosen, so read it fresh, do not hold on to it across a restart. */
  session: TrainingSession;
  private _scenario: Scenario;
  /** The flight and variation the active scenario was built from. */
  private _activeFlight: FlightDef;
  private _variation: number;
  /** The flight picked on the picker (or the active one until a pick): the mode screen and the next scenario are for it. */
  private _chosen: FlightDef;
  private _state: FlowState = 'welcome';
  private pausedFrom: 'running' | 'redo' = 'running';
  /** Set by restart(): the fresh engine has started (cues held, clock paused) and waits for Begin. */
  private restartPending = false;
  private _guided = false;
  /** The practice step was completed in this page session: later mode choices skip it. Never reset. */
  private practiceCompleted = false;
  private dirty = true;
  private sinceLive = 0;
  private liveSent: boolean | undefined;
  private runner: AutoRunner;
  private offEnded: () => void;
  private readonly sync: ControlSync;
  private readonly rnd: () => number;
  private readonly loadLast: (flightId: string) => number | null;
  private readonly saveLast: (flightId: string, variation: number) => void;
  private readonly listeners = new Set<(s: FlowState) => void>();
  private readonly scenarioListeners = new Set<(s: Scenario) => void>();

  constructor(private readonly deps: AppDeps) {
    const { bus, panels, displays } = deps;
    const only = deps.scenario ? [legacyFlight(deps.scenario)] : [];
    this.flights = deps.flights ?? only;
    if (this.flights.length === 0) throw new Error('TrainerApp needs a scenario or at least one flight');
    this.rnd = deps.rnd ?? Math.random;
    this.loadLast = deps.loadLastVariation ?? ((id) => loadLastVariation(id));
    this.saveLast = deps.saveLastVariation ?? ((id, v) => saveLastVariation(id, v));
    const { flight: start, variation } = startingPoint(this.flights, deps.devOverride);
    this._activeFlight = start;
    this._chosen = start;
    this._variation = variation;
    this._scenario = deps.scenario ?? start.build(variation);
    this.session = new TrainingSession(this._scenario, { mode: 'auto' });
    bus.onCue(({ body }) => this.crewCaption.apply(body, deps.nowMs?.() ?? performance.now()));
    this.sync = new ControlSync(deps.controls);
    this.runner = startAuto(this.session, bus, { panels, isLive: () => this.engineTakesActions() });
    this.offEnded = this.session.onEnded(() => this.apply({ type: 'ended' }));
    bus.onAction((a) => {
      if (a.kind !== 'control') return;
      this.sync.invalidate(a.controlId);
      this.dirty = true;
      if (this._state === 'practice' && a.controlId === this._scenario.practice.controlId) {
        this.practiceCompleted = true;
        this.apply({ type: 'practiceDone' });
      }
    });
    panels.onPause(() => this.pause());
    displays.setAirportNames(airportNames(this._scenario));
    this.push(this._scenario.initialAircraft);
    this.syncLive();
  }

  /** The scenario being flown (or about to be, once a mode is chosen). */
  get scenario(): Scenario {
    return this._scenario;
  }

  /** The flight picked on the picker; before a pick, the flight of the active scenario. */
  get flight(): FlightDef {
    return this._chosen;
  }

  /** The flight the active scenario belongs to. Equals `flight` from the moment a mode is chosen. */
  get activeFlight(): FlightDef {
    return this._activeFlight;
  }

  /** Index of the active scenario within its flight (0 = baseline). */
  get variation(): number {
    return this._variation;
  }

  get state(): FlowState {
    return this._state;
  }

  /** Subscribe to flow changes (screens). Returns unsubscribe. */
  onChange(cb: (s: FlowState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Subscribe to scenario swaps (the screens' pads and texts). Returns unsubscribe. */
  onScenarioChange(cb: (s: Scenario) => void): () => void {
    this.scenarioListeners.add(cb);
    return () => this.scenarioListeners.delete(cb);
  }

  results(): SessionResults {
    return this.session.results();
  }

  /** The timeline of one Event Set for the debrief: the redo's when a redo of that set exists, else the first attempt's; null if the set was not graded. */
  review(eventSetId: string): { review: SetReview; attempt: 'first' | 'redo' } | null {
    const r = this.session.results();
    if (r.redo?.eventSetId === eventSetId) return { review: r.redo.review, attempt: 'redo' };
    const first = r.reviews[eventSetId];
    return first ? { review: first, attempt: 'first' } : null;
  }

  debrief(): DebriefRow[] {
    return debriefRows(this._scenario, this.session.results());
  }

  // ---- hand-driven events -------------------------------------------------------------------------------------

  continue(): void {
    if (this._state === 'welcome') void this.deps.audio?.unlock();
    this.apply({ type: 'continue', skipFlightSelect: this.flights.length < 2 });
  }

  /** True for a guided flight (the mode chosen most recently; it stays through debrief and restart until the next choice). */
  get guided(): boolean {
    return this._guided;
  }

  /**
   * The picker: remember the flight. The scenario itself is built when the mode is chosen (guided always flies the baseline,
   * practise alone draws a variation), so nothing is swapped yet.
   */
  chooseFlight(id: string): void {
    if (this._state !== 'flightSelect') return;
    const f = this.flights.find((x) => x.id === id);
    if (!f) return;
    void this.deps.audio?.unlock();
    this._chosen = f;
    this.apply({ type: 'chooseFlight' });
  }

  chooseAuto(): void {
    if (this._state === 'modeSelect') {
      void this.deps.audio?.unlock();
      this._guided = false;
      this.selectScenario(false);
    }
    this.apply({ type: 'chooseAuto', skipPractice: this.practiceCompleted });
  }

  chooseGuided(): void {
    if (this._state === 'modeSelect') {
      if (!this._chosen.guided) return; // this flight has no guide steps: the screen does not offer the choice
      void this.deps.audio?.unlock();
      this._guided = true;
      this.selectScenario(true);
    }
    this.apply({ type: 'chooseGuided', skipPractice: this.practiceCompleted });
  }

  /** The guide step to show: null unless guided and the flow is running or redo, or when there is nothing to show. */
  guide(): GuideView | null {
    const world = this.deps.guideWorld;
    if (!this._guided || !isLive(this._state) || !world) return null;
    const engine = this.session.engine;
    const ctx = engine.conditionContext();
    const id = engine.status.eventSetId;
    if (!ctx || id === null) return null;
    return currentGuide(this._scenario.eventSets.find((e) => e.id === id)?.guide, ctx, world);
  }

  begin(): void {
    if (this._state !== 'briefing') return;
    void this.deps.audio?.unlock();
    this.session.setPatience(this._guided ? 2 : 1);
    this.apply({ type: 'begin' });
    this.sinceLive = 0;
    if (this.restartPending) {
      this.restartPending = false;
      this.runner.release();
      this.session.engine.resume();
    } else if (this.session.engine.status.run === 'idle') {
      this.session.start();
    }
    this.dirty = true;
    this.syncLive();
  }

  pause(): void {
    if (!isLive(this._state)) return;
    this.pausedFrom = this._state;
    this.session.engine.pause();
    this.apply({ type: 'pause' });
  }

  resume(): void {
    if (this._state !== 'paused') return;
    void this.deps.audio?.unlock();
    this.session.engine.resume();
    this.sinceLive = 0;
    this.apply({ type: 'resume', to: this.pausedFrom });
    this.syncLive();
  }

  /** World / page visibility: anything but 'visible' pauses. Becoming visible again never resumes by itself. */
  visibility(v: string): void {
    if (v === 'visible') return;
    if (this._state === 'debrief' || this._state === 'finished') this.deps.audio?.reset();
    else this.pause();
  }

  redo(eventSetId: string): void {
    if (this._state !== 'debrief') return;
    if (!this.session.results().original.some((g) => g.eventSetId === eventSetId)) return;
    void this.deps.audio?.unlock();
    this.clearPanels();
    this.sinceLive = 0;
    this.apply({ type: 'redo', eventSetId });
    try {
      this.session.redo(eventSetId); // re-emits the set's start cues synchronously, after the reset above
    } catch {
      this.deps.audio?.reset();
      this._state = 'debrief';
      this.emit();
    }
    this.dirty = true;
    this.syncLive();
  }

  restart(): void {
    if (this._state !== 'debrief' && this._state !== 'finished') return;
    this.startOver();
    this.apply({ type: 'restart', skipFlightSelect: this.flights.length < 2 });
  }

  /**
   * RESTART on the Paused screen (T51): end the run now, with no debrief and its scores discarded, and go back to choosing a
   * flight (the mode screen when there is only one). Everything the run left is cleared exactly as after a debrief RESTART.
   * The practice step stays done, the guided choice stays as it was (the next mode choice sets it), and the seat is not touched.
   */
  abandon(): void {
    if (this._state !== 'paused') return;
    this.startOver();
    this.apply({ type: 'abandon', skipFlightSelect: this.flights.length < 2 });
  }

  /**
   * A fresh engine of the active scenario, started and held (clock paused, cues queued) until Begin, and every message, alert and
   * sound of the run before it cleared. The next flight choice may still swap the scenario.
   */
  private startOver(): void {
    void this.deps.audio?.unlock();
    this.clearPanels();
    this.runner.hold();
    this.session.restart();
    this.session.engine.pause();
    this.restartPending = true;
    this.sync.invalidateAll();
    this.dirty = true;
  }

  finish(): void {
    this.apply({ type: 'finish' });
  }

  // ---- per frame ----------------------------------------------------------------------------------------------

  frame(dtSec: number): void {
    const live = isLive(this._state);
    if (live) {
      const dt = dtSec > MAX_DT_SEC ? MAX_DT_SEC : dtSec;
      this.sinceLive += dt;
      this.session.engine.tick(dt);
    }
    this.syncLive();
    if (live || this.dirty) {
      this.dirty = false;
      this.push(this.session.engine.state);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** The ONE predicate: does the engine take pilot actions right now? Gates engine.dispatch and the panels alike. */
  private engineTakesActions(): boolean {
    return isLive(this._state) && this.sinceLive >= ENGAGE_GRACE_SEC;
  }

  /** Tell the panels when the predicate changes (no work, no allocation otherwise). */
  private syncLive(): void {
    const live = this.engineTakesActions();
    if (live === this.liveSent) return;
    this.liveSent = live;
    this.deps.panels.setLive(live);
    this.deps.displays.setLive?.(live);
  }

  /**
   * The mode was chosen: decide which variation of the chosen flight is flown (guided: the baseline; practise alone: a draw that
   * avoids the one flown last; the dev override pins it) and swap the scenario when it differs from the active one.
   */
  private selectScenario(guided: boolean): void {
    const flight = this._chosen;
    const pinned = this.deps.devOverride?.variation;
    const variation =
      pinned !== undefined && pinned >= 0 && pinned < flight.variations ? pinned : guided ? 0 : pickVariation(flight.variations, this.loadLast(flight.id), this.rnd);
    this.saveLast(flight.id, variation);
    if (flight.id !== this._activeFlight.id || variation !== this._variation) this.swapScenario(flight, variation);
  }

  /** Replace the scenario: a new session and auto runner, and every panel, display and screen that holds scenario content. */
  private swapScenario(flight: FlightDef, variation: number): void {
    const { bus, panels, displays } = this.deps;
    const scenario = flight.build(variation);
    this.runner.dispose();
    this.offEnded();
    this._activeFlight = flight;
    this._variation = variation;
    this._scenario = scenario;
    this.session = new TrainingSession(scenario, { mode: 'auto' });
    this.runner = startAuto(this.session, bus, { panels, isLive: () => this.engineTakesActions() });
    this.offEnded = this.session.onEnded(() => this.apply({ type: 'ended' }));
    this.restartPending = false; // the new engine is idle: Begin starts it, like the first flight of a page
    this.clearPanels();
    panels.setScenario(scenario);
    displays.setAirportNames(airportNames(scenario));
    this.sync.invalidateAll();
    this.push(scenario.initialAircraft);
    this.dirty = true;
    for (const cb of [...this.scenarioListeners]) cb(scenario);
  }

  private push(s: AircraftState): void {
    this.deps.displays.setAircraft(s);
    this.deps.panels.setAircraft(s);
    this.sync.sync(s);
  }

  private clearPanels(): void {
    this.crewCaption.reset();
    this.deps.audio?.reset(); // Must precede restart/redo start cues, just like the panels.
    this.deps.panels.reset();
    this.deps.displays.resetAlerts([]);
  }

  private apply(ev: FlowEvent): void {
    const next = flowReducer(this._state, ev);
    if (next === this._state) return;
    this._state = next;
    if (next === 'paused' || next === 'debrief' || next === 'finished') this.crewCaption.reset();
    if (next === 'paused') this.deps.audio?.setPaused(true);
    else if (isLive(next)) {
      this.deps.audio?.setPaused(false);
      this.deps.audio?.setAmbient(true);
    } else if (next === 'debrief' || next === 'finished') this.deps.audio?.endRun();
    this.syncLive();
    this.emit();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb(this._state);
  }
}

const airportNames = (s: Scenario): Record<string, string> => Object.fromEntries(s.airports.map((a) => [a.id, a.name]));

/** A caller that flies one fixed scenario (headless tests): it is the only flight, so there is no picker. */
function legacyFlight(scenario: Scenario): FlightDef {
  return { id: scenario.id, title: scenario.title, blurb: '', minutes: 10, guided: true, variations: 1, build: () => scenario };
}
