// TrainingSession: wraps ScenarioEngine with debrief grades, one-set redo, overrides and restart.
import type { EventSetGrade, PilotAction, Stamped, WorldCue } from '../contracts/events';
import type { Scenario } from '../contracts/scenario';
import { gradeEventSet } from './grading';
import { ScenarioEngine } from './scenarioEngine';
import { elecMoments } from './power';
import { buildTimeline, type SetReview } from './timeline';

export interface SessionResults {
  original: EventSetGrade[];
  /** One timeline per graded Event Set, built at the moment of grading from the same history (first attempt). */
  reviews: Record<string, SetReview>;
  redo?: { eventSetId: string; grade: EventSetGrade; review: SetReview };
}

export class TrainingSession {
  private _engine: ScenarioEngine;
  private originals: EventSetGrade[] | null = null;
  private originalReviews: Record<string, SetReview> = {};
  private redoResult?: { eventSetId: string; grade: EventSetGrade; review: SetReview };
  private redoId: string | null = null;
  private overrides = new Map<string, { grade: 1 | 2 | 3 | 4; comment: string }>();
  private readonly cueCbs = new Set<(c: Stamped<WorldCue>) => void>();
  private readonly actionCbs = new Set<(a: Stamped<PilotAction>) => void>();
  private readonly endCbs = new Set<(r: SessionResults) => void>();
  private detach: Array<() => void> = [];
  private patience: 1 | 2 = 1;

  constructor(
    private readonly scenario: Scenario,
    private readonly opts: { mode: 'auto' | 'external' },
  ) {
    this._engine = this.attach(new ScenarioEngine(scenario, opts));
  }

  get engine(): ScenarioEngine {
    return this._engine;
  }

  setPatience(p: 1 | 2): void {
    this.patience = p;
    this._engine.patience = p;
  }

  start(): void {
    this._engine.start();
  }

  onCue(cb: (c: Stamped<WorldCue>) => void): () => void {
    this.cueCbs.add(cb);
    return () => this.cueCbs.delete(cb);
  }

  onAction(cb: (a: Stamped<PilotAction>) => void): () => void {
    this.actionCbs.add(cb);
    return () => this.actionCbs.delete(cb);
  }

  onEnded(cb: (r: SessionResults) => void): () => void {
    this.endCbs.add(cb);
    return () => this.endCbs.delete(cb);
  }

  results(): SessionResults {
    const original = (this.originals ?? []).map((g) => {
      const o = this.overrides.get(g.eventSetId);
      return o ? { ...g, grade: o.grade, source: 'instructor' as const, comment: o.comment } : { ...g };
    });
    return { original, reviews: { ...this.originalReviews }, ...(this.redoResult ? { redo: this.redoResult } : {}) };
  }

  overrideGrade(eventSetId: string, grade: 1 | 2 | 3 | 4, comment: string): void {
    if (!this.originals?.some((g) => g.eventSetId === eventSetId)) throw new Error(`no graded event set ${eventSetId}`);
    this.overrides.set(eventSetId, { grade, comment });
  }

  redo(eventSetId: string): void {
    if (!this.originals || this._engine.status.run !== 'ended') throw new Error('redo only after scenario end');
    if (!this.originals.some((g) => g.eventSetId === eventSetId)) throw new Error(`cannot redo unvisited event set ${eventSetId}`);
    const snap = this._engine.snapshotAt(eventSetId);
    this.redoResult = undefined;
    this.redoId = eventSetId;
    this._engine.restore(snap, { stopAfterSet: true });
  }

  restart(): void {
    this.detach.forEach((d) => d());
    this.originals = null;
    this.originalReviews = {};
    this.redoResult = undefined;
    this.redoId = null;
    this.overrides = new Map();
    this._engine = this.attach(new ScenarioEngine(this.scenario, this.opts));
    this._engine.start();
  }

  private attach(e: ScenarioEngine): ScenarioEngine {
    e.patience = this.patience;
    this.detach = [
      e.onCue((c) => this.cueCbs.forEach((cb) => cb(c))),
      e.onAction((a) => this.actionCbs.forEach((cb) => cb(a))),
      e.onEnded(() => this.handleEnded(e)),
    ];
    return e;
  }

  private handleEnded(e: ScenarioEngine): void {
    const grace = this.scenario.latenessGraceSec;
    // Grade and review come from one copy of the history, so the timeline never disagrees with the grade.
    const assess = (id: string) => {
      const def = this.scenario.eventSets.find((s) => s.id === id)!;
      const history = e.historyFor(id);
      return { grade: gradeEventSet(def, history, grace), review: { entries: buildTimeline(this.scenario, def, history), elec: elecMoments(history) } };
    };
    if (!this.originals) {
      const done = this.scenario.eventSets.filter((s) => this.visited(e, s.id)).map((s) => ({ id: s.id, ...assess(s.id) }));
      this.originals = done.map((d) => d.grade);
      this.originalReviews = Object.fromEntries(done.map((d) => [d.id, d.review]));
    } else if (this.redoId) {
      this.redoResult = { eventSetId: this.redoId, ...assess(this.redoId) };
      this.redoId = null;
    }
    const r = this.results();
    this.endCbs.forEach((cb) => cb(r));
  }

  private visited(e: ScenarioEngine, id: string): boolean {
    try {
      e.snapshotAt(id);
      return true;
    } catch {
      return false;
    }
  }
}
