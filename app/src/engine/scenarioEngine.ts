// Headless scenario engine: consumes pilot actions, emits world cues, advances Event Sets.
import type { AircraftState } from '../contracts/aircraft';
import type { EndReason, PilotAction, Stamped, WorldCue } from '../contracts/events';
import type { CueRule, Scenario } from '../contracts/scenario';
import { applyControl, applyPatch, stepAircraft } from './aircraft';
import { ScenarioClock } from './clock';
import { evaluate, type CondCtx, type SetHistory } from './conditions';

const SNAPSHOT_EVERY_SEC = 0.5;
const EPS = 1e-9;

interface Visit {
  startT: number;
  actions: Stamped<PilotAction>[];
  fired: Map<string, number>;
  wasTrue: Map<string, boolean>; // edge detection for non-once rules
  history: SetHistory;
  lastSnapT: number;
}

export interface EngineSnapshot {
  setIndex: number;
  state: AircraftState;
  clockNow: number;
  promptSent: boolean;
}

export class ScenarioEngine {
  private readonly clock = new ScenarioClock();
  private readonly cueListeners = new Set<(c: Stamped<WorldCue>) => void>();
  private readonly actionListeners = new Set<(a: Stamped<PilotAction>) => void>();
  private readonly visits = new Map<string, Visit>();
  private _state: AircraftState;
  private run: 'idle' | 'running' | 'ended' = 'idle';
  private setIndex = 0;
  private endReason?: EndReason;
  private seq = 0;
  private promptSent = false;
  private pendingEval = false;
  private stopAfterSet = false;
  private readonly snaps = new Map<string, EngineSnapshot>();
  private readonly endListeners = new Set<() => void>();

  /** Scenario seconds = real seconds / patience. Aircraft motion stays at real pace. */
  patience = 1;

  constructor(
    private readonly scenario: Scenario,
    private readonly opts: { mode: 'auto' | 'external' },
  ) {
    this._state = structuredClone(scenario.initialAircraft);
  }

  get state(): AircraftState {
    return this._state;
  }

  get status(): { run: 'idle' | 'running' | 'ended'; eventSetId: string | null; tInSet: number; endReason?: EndReason } {
    const v = this.visit();
    return {
      run: this.run,
      eventSetId: this.run === 'idle' ? null : this.set.id,
      tInSet: v ? this.clock.now - v.startT : 0,
      ...(this.endReason ? { endReason: this.endReason } : {}),
    };
  }

  /** Condition context of the current Event Set; null when idle or ended. */
  conditionContext(): CondCtx | null {
    const v = this.visit();
    return this.run === 'running' && v ? this.ctxFor(v) : null;
  }

  onCue(cb: (c: Stamped<WorldCue>) => void): () => void {
    this.cueListeners.add(cb);
    return () => this.cueListeners.delete(cb);
  }

  onAction(cb: (a: Stamped<PilotAction>) => void): () => void {
    this.actionListeners.add(cb);
    return () => this.actionListeners.delete(cb);
  }

  /** Fires whenever the run reaches 'ended', including a redo that ends without scenarioEnd. */
  onEnded(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }

  /** State at the first entry to an Event Set (never overwritten by a redo). */
  snapshotAt(eventSetId: string): EngineSnapshot {
    const s = this.snaps.get(eventSetId);
    if (!s) throw new Error(`no snapshot for event set ${eventSetId}`);
    return { ...s, state: structuredClone(s.state) };
  }

  /** Rewind to a snapshot and replay that Event Set; `seq` stays monotonic. */
  restore(snap: EngineSnapshot, opts: { stopAfterSet: boolean }): void {
    this.clock.now = snap.clockNow;
    this.clock.resume();
    this._state = structuredClone(snap.state);
    this.promptSent = snap.promptSent;
    this.endReason = undefined;
    this.pendingEval = false;
    this.stopAfterSet = opts.stopAfterSet;
    this.run = 'running';
    this.enterSet(snap.setIndex);
  }

  start(): void {
    if (this.run !== 'idle') return;
    this.run = 'running';
    this.enterSet(0);
  }

  tick(dtRealSec: number): void {
    if (this.run !== 'running' || this.clock.paused) return;
    const applied = this.clock.advance(dtRealSec / this.patience);
    if (applied <= 0) return;
    this._state = stepAircraft(this._state, applied * this.patience * this.scenario.timeCompression);
    this.evaluateStep(false);
  }

  dispatch(a: PilotAction): void {
    if (this.run !== 'running') return;
    const stamped: Stamped<PilotAction> = { t: this.clock.now, seq: this.seq++, body: a };
    const v = this.visit()!;
    v.actions.push(stamped);
    if (a.kind === 'control') this._state = applyControl(this._state, a);
    if (a.kind === 'hint') v.history.hintTimes.push(stamped.t);
    this.actionListeners.forEach((cb) => cb(stamped));
    if (this.clock.paused) this.pendingEval = true;
    else this.evaluateStep(true);
  }

  fireRule(ruleId: string): boolean {
    if (this.run !== 'running' || this.clock.paused) return false;
    const rule = this.set.rules.find((r) => r.id === ruleId);
    const v = this.visit()!;
    if (!rule || (this.isOnce(rule) && v.fired.has(rule.id))) return false;
    this.fire(rule, v);
    return true;
  }

  pause(): void {
    this.clock.pause();
  }

  resume(): void {
    this.clock.resume();
    if (this.pendingEval && this.run === 'running') {
      this.pendingEval = false;
      this.evaluateStep(true);
    }
  }

  actionsFor(eventSetId: string): Stamped<PilotAction>[] {
    return [...(this.visits.get(eventSetId)?.actions ?? [])];
  }

  firedFor(eventSetId: string): Map<string, number> {
    return new Map(this.visits.get(eventSetId)?.fired);
  }

  historyFor(eventSetId: string): SetHistory {
    const h = this.visits.get(eventSetId)?.history;
    return h ? { snapshots: [...h.snapshots], hintTimes: [...h.hintTimes] } : { snapshots: [], hintTimes: [] };
  }

  // ---------------------------------------------------------------------------

  private get set() {
    return this.scenario.eventSets[this.setIndex];
  }

  private visit(): Visit | undefined {
    return this.run === 'idle' ? undefined : this.visits.get(this.set.id);
  }

  private isOnce(r: CueRule): boolean {
    return r.once !== false;
  }

  private emit(body: WorldCue): void {
    const cue: Stamped<WorldCue> = { t: this.clock.now, seq: this.seq++, body };
    if (body.kind === 'aircraft') this._state = applyPatch(this._state, body.patch);
    this.cueListeners.forEach((cb) => cb(cue));
  }

  private ctxFor(v: Visit, fired: ReadonlyMap<string, number> = v.fired): CondCtx {
    return { tInSet: this.clock.now - v.startT, state: this._state, actions: v.actions, fired, now: this.clock.now };
  }

  private snapshot(v: Visit): void {
    const ctx = this.ctxFor(v, new Map(v.fired));
    v.history.snapshots.push({ t: this.clock.now, ctx: { ...ctx, actions: [...v.actions] } });
    v.lastSnapT = this.clock.now;
  }

  private enterSet(index: number): void {
    this.setIndex = index;
    const es = this.set;
    if (!this.snaps.has(es.id))
      this.snaps.set(es.id, { setIndex: index, state: structuredClone(this._state), clockNow: this.clock.now, promptSent: this.promptSent });
    const v: Visit = {
      startT: this.clock.now,
      actions: [],
      fired: new Map(),
      wasTrue: new Map(),
      history: { snapshots: [], hintTimes: [] },
      lastSnapT: this.clock.now,
    };
    this.visits.set(es.id, v);
    this.emit({ kind: 'eventSet', eventSetId: es.id, status: 'start' });
    es.startCues.forEach((c) => this.emit(c));
    this.snapshot(v);
  }

  private fire(rule: CueRule, v: Visit): void {
    v.fired.set(rule.id, this.clock.now);
    rule.cues.forEach((c) => this.emit(c));
    this.snapshot(v);
  }

  private endScenario(reason: EndReason): void {
    this.snapshot(this.visit()!); // final state of the ending set must be gradable
    this.endReason = reason;
    this.emit({ kind: 'scenarioEnd', reason });
    this.finish();
  }

  private finish(): void {
    this.run = 'ended';
    this.endListeners.forEach((cb) => cb());
  }

  /** Steps 3-6: rules, endConditions, soft timeout, endWhen. */
  private evaluateStep(fromDispatch: boolean): void {
    const v = this.visit()!;
    const es = this.set;

    for (const rule of es.rules) {
      if (this.opts.mode === 'external' && !rule.physical) continue;
      const once = this.isOnce(rule);
      if (once && v.fired.has(rule.id)) continue;
      const holds = evaluate(rule.when, this.ctxFor(v));
      const edge = holds && !v.wasTrue.get(rule.id);
      v.wasTrue.set(rule.id, holds);
      if (once ? holds : edge) this.fire(rule, v);
    }

    const merged = new Map<string, number>();
    // Only sets up to the current one: a redo must not see stale firings from later sets.
    for (let i = 0; i <= this.setIndex; i++)
      for (const [id, t] of this.visits.get(this.scenario.eventSets[i].id)?.fired ?? [])
        merged.set(id, Math.max(t, merged.get(id) ?? -Infinity));
    const endCtx = this.ctxFor(v, merged);
    for (const ec of this.scenario.endConditions) {
      if (evaluate(ec.when, endCtx)) return this.endScenario(ec.reason);
    }

    const st = this.scenario.softTimeout;
    if (st.eventSetId === es.id) {
      const tInSet = this.clock.now - v.startT;
      if (!this.promptSent && tInSet >= st.promptAtSec - EPS) {
        this.promptSent = true; // handled either way: skipped prompts are not re-tried later
        if (!(st.skipPromptWhen && evaluate(st.skipPromptWhen, endCtx))) this.emit(st.promptCue);
      }
      if (tInSet >= st.afterSec - EPS) return this.endScenario('timeout');
    }

    const isLast = this.setIndex >= this.scenario.eventSets.length - 1;
    if (!isLast && evaluate(es.endWhen, this.ctxFor(v))) {
      this.snapshot(v);
      this.emit({ kind: 'eventSet', eventSetId: es.id, status: 'end' });
      if (this.stopAfterSet) {
        this.stopAfterSet = false;
        return this.finish(); // redo: no scenarioEnd (EndReason has no 'redo')
      }
      this.enterSet(this.setIndex + 1);
      return;
    }

    if (fromDispatch || this.clock.now - v.lastSnapT >= SNAPSHOT_EVERY_SEC - EPS) this.snapshot(v);
  }
}
