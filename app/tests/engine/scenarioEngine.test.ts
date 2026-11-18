import { describe, expect, it } from 'vitest';
import type { PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import { parseScenario, type Scenario } from '../../src/contracts/scenario';
import { ScenarioEngine } from '../../src/engine/scenarioEngine';
import { miniScenario } from '../fixtures/mini-scenario';

const mini = (): Scenario => parseScenario(structuredClone(miniScenario));
function make(mode: 'auto' | 'external' = 'auto', s: Scenario = mini()) {
  const e = new ScenarioEngine(s, { mode });
  const cues: Stamped<WorldCue>[] = [];
  e.onCue((c) => cues.push(c));
  return { e, cues };
}
const ids = (cues: Stamped<WorldCue>[]) => cues.map((c) => (c.body.kind === 'eventSet' ? `${c.body.eventSetId}:${c.body.status}` : 'id' in c.body ? c.body.id : c.body.kind));
const reply: PilotAction = { kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' };
const lights: PilotAction = { kind: 'control', controlId: 'lights.landing', value: true };
const toDep: PilotAction = { kind: 'control', controlId: 'route.destination', value: 'dep' };
const advanceToB = (e: ScenarioEngine) => { e.dispatch(reply); e.dispatch(lights); };

describe('ScenarioEngine', () => {
  it('start emits ES1 start and startCues in order', () => {
    const { e, cues } = make();
    expect(e.status.run).toBe('idle');
    e.start();
    expect(ids(cues)).toEqual(['es-a:start', 'msg-a1']);
    expect(cues.map((c) => c.seq)).toEqual([0, 1]);
    expect(e.status).toMatchObject({ run: 'running', eventSetId: 'es-a', tInSet: 0 });
  });

  it('atSec rule fires once at 5s', () => {
    const { e, cues } = make();
    e.start();
    e.tick(4.9);
    expect(ids(cues)).not.toContain('pr-a');
    e.tick(0.1);
    e.tick(10);
    expect(ids(cues).filter((i) => i === 'pr-a')).toHaveLength(1);
    expect(cues.find((c) => c.body.kind === 'printout')!.t).toBeCloseTo(5);
  });

  it('action rule fires after matching reply', () => {
    const { e, cues } = make();
    e.start();
    e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-no' });
    expect(ids(cues)).not.toContain('msg-a2');
    e.dispatch(reply);
    expect(ids(cues)).toContain('msg-a2');
    expect(e.firedFor('es-a').has('r-a-reply')).toBe(true);
  });

  it('ruleFired afterSec chains and aircraft cues apply to state', () => {
    const { e, cues } = make();
    e.start();
    e.dispatch(reply);
    e.tick(1.9);
    expect(e.state.ap.alt).toBe(5000);
    e.tick(0.1);
    expect(e.state.ap.alt).toBe(6000);
    expect(cues.filter((c) => c.body.kind === 'aircraft')).toHaveLength(1);
  });

  it('endWhen advances to ES2 (end then start, startCues, tInSet resets)', () => {
    const { e, cues } = make();
    e.start();
    e.tick(3);
    e.dispatch(reply);
    cues.length = 0;
    e.dispatch(lights);
    expect(ids(cues)).toEqual(['es-a:end', 'es-b:start', 'alert-b', 'checklistAvailable']);
    expect(e.status).toMatchObject({ eventSetId: 'es-b', tInSet: 0 });
    expect(e.actionsFor('es-b')).toHaveLength(0);
    expect(e.actionsFor('es-a')).toHaveLength(2);
  });

  it('external mode suppresses non-physical rules but fires physical', () => {
    const { e, cues } = make('external');
    e.start();
    e.tick(6);
    expect(ids(cues)).toEqual(['es-a:start', 'msg-a1']); // r-a-time not physical
    const s = mini();
    s.eventSets[0].rules[0].physical = true;
    const x = make('external', s);
    x.e.start();
    x.e.tick(6);
    expect(ids(x.cues)).toContain('pr-a');
  });

  it('fireRule emits in external mode', () => {
    const { e, cues } = make('external');
    e.start();
    expect(e.fireRule('r-a-time')).toBe(true);
    expect(ids(cues)).toContain('pr-a');
    expect(e.firedFor('es-a').has('r-a-time')).toBe(true);
    expect(e.fireRule('r-a-time')).toBe(false); // once
    expect(e.fireRule('r-b-fail')).toBe(false); // other set
    expect(e.fireRule('nope')).toBe(false);
  });

  it('no cues or timeout progress while paused', () => {
    const { e, cues } = make();
    e.start();
    e.tick(1);
    e.pause();
    const n = cues.length;
    e.tick(100);
    expect(cues).toHaveLength(n);
    expect(e.status.tInSet).toBeCloseTo(1);
    e.dispatch(reply); // recorded, not evaluated
    expect(e.actionsFor('es-a')).toHaveLength(1);
    expect(e.actionsFor('es-a')[0].t).toBeCloseTo(1);
    expect(cues).toHaveLength(n);
    e.resume();
    expect(ids(cues)).toContain('msg-a2');
    e.tick(4);
    expect(ids(cues)).toContain('pr-a');
  });

  it('soft timeout prompts at promptAtSec then ends at afterSec', () => {
    const { e, cues } = make();
    e.start();
    advanceToB(e);
    e.tick(119);
    expect(ids(cues)).not.toContain('msg-intentions');
    e.tick(1);
    e.tick(30);
    expect(ids(cues).filter((i) => i === 'msg-intentions')).toHaveLength(1);
    expect(e.status.run).toBe('running');
    e.tick(30);
    const end = cues.filter((c) => c.body.kind === 'scenarioEnd');
    expect(end).toHaveLength(1);
    expect(end[0].body).toEqual({ kind: 'scenarioEnd', reason: 'timeout' });
    expect(e.status).toMatchObject({ run: 'ended', endReason: 'timeout' });
    const n = cues.length;
    e.tick(10);
    e.dispatch(toDep);
    expect(cues).toHaveLength(n);
  });

  it('softTimeout.skipPromptWhen true at prompt time: prompt skipped, timeout still ends the run', () => {
    const s = structuredClone(miniScenario) as any;
    s.softTimeout.skipPromptWhen = { kind: 'state', path: 'lights.landing', op: 'eq', value: true };
    const { e, cues } = make('auto', parseScenario(s));
    e.start();
    advanceToB(e); // lights on: condition true
    e.tick(121);
    expect(ids(cues)).not.toContain('msg-intentions');
    e.tick(30); // not re-tried later
    expect(ids(cues)).not.toContain('msg-intentions');
    e.tick(30);
    expect(e.status).toMatchObject({ run: 'ended', endReason: 'timeout' });
  });

  it('softTimeout.skipPromptWhen false at prompt time: prompt still emitted', () => {
    const s = structuredClone(miniScenario) as any;
    s.softTimeout.skipPromptWhen = { kind: 'state', path: 'lights.strobe', op: 'eq', value: true };
    const { e, cues } = make('auto', parseScenario(s));
    e.start();
    advanceToB(e);
    e.tick(121);
    expect(ids(cues).filter((i) => i === 'msg-intentions')).toHaveLength(1);
  });

  it('endCondition ends the scenario with priority; last set does not emit end', () => {
    const { e, cues } = make();
    e.start();
    advanceToB(e);
    e.tick(2);
    expect(ids(cues)).toContain('alert-b');
    e.dispatch(toDep); // satisfies both endWhen of es-b and endCondition
    expect(ids(cues)).not.toContain('es-b:end');
    expect(cues.filter((c) => c.body.kind === 'scenarioEnd')).toHaveLength(1);
    expect(e.status).toMatchObject({ run: 'ended', endReason: 'diversionSetUp' });
  });

  it('duplicate action is idempotent for required checks', () => {
    const { e, cues } = make();
    e.start();
    e.dispatch(reply);
    e.dispatch(reply);
    expect(e.actionsFor('es-a')).toHaveLength(2);
    expect(ids(cues).filter((i) => i === 'msg-a2')).toHaveLength(1);
  });

  it('non-once rule is edge-triggered', () => {
    const s = mini();
    s.eventSets[0].rules[1].once = false;
    const { e, cues } = make('auto', s);
    e.start();
    e.dispatch(reply);
    e.dispatch(reply);
    e.tick(1);
    expect(ids(cues).filter((i) => i === 'msg-a2')).toHaveLength(1);
  });

  it('stamps seq monotonically across actions and cues; hint times recorded', () => {
    const { e, cues } = make();
    const acts: Stamped<PilotAction>[] = [];
    const off = e.onAction((a) => acts.push(a));
    e.start();
    e.dispatch({ kind: 'hint', eventSetId: 'es-a' });
    e.dispatch(reply);
    off();
    e.dispatch(lights);
    expect(acts).toHaveLength(2);
    const all = [...cues.map((c) => c.seq), ...acts.map((a) => a.seq)];
    expect(new Set(all).size).toBe(all.length);
    expect(e.historyFor('es-a').hintTimes).toEqual([0]);
  });

  it('records snapshots at dispatch and throttles to one per 0.5 s during ticks', () => {
    const { e } = make('external'); // no rules interfering
    e.start();
    expect(e.historyFor('es-a').snapshots).toHaveLength(1);
    e.dispatch(reply);
    e.dispatch(reply);
    expect(e.historyFor('es-a').snapshots).toHaveLength(3);
    for (let i = 0; i < 100; i++) e.tick(0.1); // 10 s
    const snaps = e.historyFor('es-a').snapshots;
    expect(snaps.length).toBeLessThanOrEqual(3 + 20 + 1);
    expect(snaps.length).toBeGreaterThan(10);
    for (let i = 1; i < snaps.length; i++) expect(snaps[i].t).toBeGreaterThanOrEqual(snaps[i - 1].t);
    const last = snaps[snaps.length - 1];
    expect(last.ctx.actions).toHaveLength(2);
    expect(e.historyFor('es-b')).toEqual({ snapshots: [], hintTimes: [] });
  });

  it('final state of an ending set is snapshotted (dispatch-driven endWhen and endCondition)', () => {
    const { e } = make();
    e.start();
    e.tick(3);
    e.dispatch(reply);
    e.dispatch(lights);
    const a = e.historyFor('es-a').snapshots;
    const lastA = a[a.length - 1];
    expect(lastA.ctx.state.lights.landing).toBe(true);
    expect(lastA.ctx.actions).toHaveLength(2);
    expect(a.some((s) => s.ctx.state.lights.landing === true && s.ctx.actions.length === 2)).toBe(true);
    e.dispatch(toDep);
    const b = e.historyFor('es-b').snapshots;
    const lastB = b[b.length - 1];
    expect(lastB.ctx.state.destination).toBe('dep');
    expect(lastB.ctx.actions).toHaveLength(1);
  });

  it('tick-driven timeout leaves a final snapshot at t >= afterSec', () => {
    const { e } = make();
    e.start();
    advanceToB(e);
    const tb = e.status.tInSet;
    expect(tb).toBe(0);
    const startT = e.historyFor('es-b').snapshots[0].t;
    for (let i = 0; i < 18; i++) e.tick(10);
    expect(e.status.run).toBe('ended');
    const snaps = e.historyFor('es-b').snapshots;
    expect(snaps[snaps.length - 1].t).toBeGreaterThanOrEqual(startT + 180 - 1e-6);
  });

  it('ruleFired afterSec compares absolute time in a later set', () => {
    const s = mini();
    s.eventSets[1].rules.push(
      { id: 'r-b-first', instructorLabel: 'first', when: { kind: 'atSec', sec: 1 }, cues: [{ kind: 'alertClear', id: 'alert-b' }] },
      { id: 'r-b-chain', instructorLabel: 'chain', when: { kind: 'ruleFired', ruleId: 'r-b-first', afterSec: 2 }, cues: [{ kind: 'alert', id: 'alert-c', level: 'advisory', text: 'Chain' }] },
    );
    const { e, cues } = make('auto', s);
    e.start();
    e.tick(6);
    advanceToB(e); // set B starts at t=6
    e.tick(1);
    expect(ids(cues)).not.toContain('alert-c');
    e.tick(1.9);
    expect(ids(cues)).not.toContain('alert-c');
    e.tick(0.1);
    expect(ids(cues)).toContain('alert-c');
  });

  it('fireRule while paused returns false and does nothing', () => {
    const { e, cues } = make('external');
    e.start();
    e.pause();
    const n = cues.length;
    expect(e.fireRule('r-a-time')).toBe(false);
    expect(cues).toHaveLength(n);
    e.resume();
    expect(e.fireRule('r-a-time')).toBe(true);
  });

  describe('patience', () => {
    const moving = (): Scenario => {
      const raw = structuredClone(miniScenario) as any;
      raw.timeCompression = 1;
      raw.initialAircraft.phase = 'cruise';
      raw.initialAircraft.ap = { engaged: true, hdg: 150, alt: 40000, lateral: 'hdg', vertical: 'climb' };
      return parseScenario(raw);
    };
    const run = (patience: number, s: Scenario, secs: number) => {
      const { e } = make('auto', s);
      e.patience = patience;
      e.start();
      for (let i = 0; i < secs * 10; i++) e.tick(0.1);
      return e;
    };

    it('patience 2 halves scenario time and leaves aircraft motion alone', () => {
      const a = run(1, moving(), 10);
      const b = run(2, moving(), 10);
      expect(a.status.tInSet).toBeCloseTo(10);
      expect(b.status.tInSet).toBeCloseTo(5);
      expect(b.state.altitudeFt).toBeGreaterThan(0);
      expect(b.state.altitudeFt).toBeCloseTo(a.state.altitudeFt, 6);
      expect(b.state.headingDeg).toBeCloseTo(a.state.headingDeg, 6);
    });

    it('patience 2 doubles a set time limit', () => {
      const raw = structuredClone(miniScenario) as any;
      raw.eventSets[0].endWhen = { kind: 'atSec', sec: 10 };
      const timed = () => parseScenario(structuredClone(raw));
      const a = run(1, timed(), 11);
      const b = run(2, timed(), 11);
      expect(a.status.eventSetId).toBe('es-b');
      expect(b.status.eventSetId).toBe('es-a');
      for (let i = 0; i < 100; i++) b.tick(0.1);
      expect(b.status.eventSetId).toBe('es-b');
    });
  });

  it('conditionContext is null before start and after the end, and has tInSet and state while running', () => {
    const { e } = make();
    expect(e.conditionContext()).toBeNull();
    e.start();
    e.tick(2);
    const ctx = e.conditionContext()!;
    expect(ctx.tInSet).toBeCloseTo(2);
    expect(ctx.state.destination).toBe('dest');
    advanceToB(e);
    e.dispatch(toDep);
    expect(e.status.run).toBe('ended');
    expect(e.conditionContext()).toBeNull();
  });
});
