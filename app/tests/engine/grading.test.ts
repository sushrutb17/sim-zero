import { describe, expect, it } from 'vitest';
import type { PilotAction, Stamped } from '../../src/contracts/events';
import { parseScenario, type CheckDef, type Condition, type EventSetDef } from '../../src/contracts/scenario';
import type { CondCtx, SetHistory } from '../../src/engine/conditions';
import { gradeEventSet } from '../../src/engine/grading';
import { ScenarioEngine } from '../../src/engine/scenarioEngine';
import { miniScenario } from '../fixtures/mini-scenario';

const scenario = parseScenario(structuredClone(miniScenario));
const baseState = scenario.initialAircraft;
const esA = scenario.eventSets[0];
const GRACE = 10;

const lightsOn: Condition = { kind: 'state', path: 'lights.landing', op: 'eq', value: true };
const gen2Off: Condition = { kind: 'action', match: { kind: 'control', controlId: 'elec.gen2', value: false } };
const gen2On: Condition = { kind: 'action', match: { kind: 'control', controlId: 'elec.gen2', value: true } };
const destDest: Condition = { kind: 'state', path: 'destination', op: 'eq', value: 'dest' };

const required = (id: string, withinSec?: number | null): CheckDef => ({ kind: 'required', id, when: lightsOn, withinSec: withinSec === null ? undefined : (withinSec ?? 30), category: 'procedures', reason: `req ${id}` });
const trap = (id: string, severity: 'minor' | 'major', trapWithinSec?: number): CheckDef => ({ kind: 'errorTrap', id, when: gen2Off, trappedWhen: gen2On, trapWithinSec, severity, category: 'systems', reason: `trap ${id}` });
const comm = (id = 'c'): CheckDef => ({ kind: 'comm', id, messageId: 'msg-a1', quality: { 'card-yes': 'good', 'card-no': 'poor', 'card-ok': 'acceptable' }, category: 'crm', reason: `comm ${id}` });
const safety = (id: string, category: CheckDef['category'] = 'crm'): CheckDef => ({ kind: 'safety', id, when: destDest, category, reason: `safety ${id}` });

const def = (checks: CheckDef[], over: Partial<EventSetDef> = {}): EventSetDef => ({ ...esA, startCues: [], rules: [], checks, ...over });

const ctrl = (controlId: string, value: boolean, t: number, seq: number): Stamped<PilotAction> => ({ t, seq, body: { kind: 'control', controlId, value } as PilotAction });
const rep = (cardId: string, t: number, seq: number, messageId = 'msg-a1'): Stamped<PilotAction> => ({ t, seq, body: { kind: 'reply', messageId, cardId } });

interface SnapOpts { lights?: boolean; dest?: string; actions?: Stamped<PilotAction>[]; fired?: [string, number][] }
const snap = (t: number, o: SnapOpts = {}) => {
  const ctx: CondCtx = {
    tInSet: t,
    now: t,
    state: { ...baseState, destination: o.dest ?? 'dep', lights: { ...baseState.lights, landing: o.lights ?? false } },
    actions: o.actions ?? [],
    fired: new Map(o.fired ?? []),
  };
  return { t, ctx };
};
const hist = (snapshots: SetHistory['snapshots'], hintTimes: number[] = []): SetHistory => ({ snapshots, hintTimes });
const okHist = (extra: SnapOpts = {}) => hist([snap(0), snap(5, { lights: true, ...extra }), snap(40, { lights: true, ...extra })]);

describe('gradeEventSet', () => {
  it('all ok -> 4, no reasons', () => {
    const g = gradeEventSet(def([required('r'), trap('t', 'major', 20), safety('s')]), okHist(), GRACE);
    expect(g).toEqual({ eventSetId: 'es-a', grade: 4, reasons: [], hintUsed: false, source: 'auto' });
  });

  it('late required -> 3 with its reason (grace boundary is on time)', () => {
    const d = def([required('r')]);
    const late = gradeEventSet(d, hist([snap(0), snap(40.5, { lights: true })]), GRACE);
    expect(late.grade).toBe(3);
    expect(late.reasons).toEqual([{ category: 'procedures', text: 'req r' }]);
    expect(gradeEventSet(d, hist([snap(0), snap(40, { lights: true })]), GRACE).grade).toBe(4);
  });

  it('required without withinSec is ok whenever satisfied', () => {
    expect(gradeEventSet(def([required('r', null)]), hist([snap(0), snap(900, { lights: true })]), GRACE).grade).toBe(4);
  });

  it('required after hint -> 2, hintUsed true', () => {
    const g = gradeEventSet(def([required('r')]), hist([snap(0), snap(8, { lights: true })], [6]), GRACE);
    expect(g.grade).toBe(2);
    expect(g.hintUsed).toBe(true);
    expect(g.reasons).toEqual([{ category: 'procedures', text: 'req r' }]);
  });

  it('hint after satisfaction does not make it prompted', () => {
    const g = gradeEventSet(def([required('r')]), hist([snap(0), snap(5, { lights: true }), snap(20, { lights: true })], [15]), GRACE);
    expect(g.grade).toBe(4);
    expect(g.hintUsed).toBe(true);
  });

  it('required satisfied only in the final snapshot counts ok', () => {
    expect(gradeEventSet(def([required('r')]), hist([snap(0), snap(12), snap(25, { lights: true })]), GRACE).grade).toBe(4);
  });

  it('missed required -> 1', () => {
    const g = gradeEventSet(def([required('r')]), hist([snap(0), snap(60)]), GRACE);
    expect(g.grade).toBe(1);
    expect(g.reasons).toHaveLength(1);
  });

  it('empty history grades as missed without crashing', () => {
    expect(gradeEventSet(def([required('r')]), hist([]), GRACE).grade).toBe(1);
    expect(gradeEventSet(def([comm()], { startCues: esA.startCues }), hist([]), GRACE).grade).toBe(3);
  });

  it('safety violated -> 1 and safety reason first', () => {
    const g = gradeEventSet(def([required('r'), safety('s')]), hist([snap(0), snap(5, { lights: true }), snap(9, { lights: true, dest: 'dest' }), snap(12, { lights: true })]), GRACE);
    expect(g.grade).toBe(1);
    expect(g.reasons[0]).toEqual({ category: 'crm', text: 'safety s' });
  });

  it('premature action becomes error trap (untrapped minor -> 2)', () => {
    const early = ctrl('elec.gen2', false, 3, 1);
    const g = gradeEventSet(def([trap('t', 'minor')]), hist([snap(0), snap(3, { actions: [early] }), snap(30, { actions: [early] })]), GRACE);
    expect(g.grade).toBe(2);
    expect(g.reasons).toEqual([{ category: 'systems', text: 'trap t' }]);
  });

  it('untrapped major -> 1; error trap that never occurs is ok', () => {
    const early = ctrl('elec.gen2', false, 3, 1);
    expect(gradeEventSet(def([trap('t', 'major')]), hist([snap(0), snap(3, { actions: [early] })]), GRACE).grade).toBe(1);
    expect(gradeEventSet(def([trap('t', 'major')]), hist([snap(0), snap(30)]), GRACE).grade).toBe(4);
  });

  it('trapped major -> 2, trapped minor -> 3', () => {
    const off = ctrl('elec.gen2', false, 3, 1);
    const on = ctrl('elec.gen2', true, 10, 2);
    const h = hist([snap(0), snap(3, { actions: [off] }), snap(10, { actions: [off, on] })]);
    expect(gradeEventSet(def([trap('t', 'major', 20)]), h, GRACE).grade).toBe(2);
    expect(gradeEventSet(def([trap('t', 'minor', 20)]), h, GRACE).grade).toBe(3);
  });

  it('trapping too late (beyond trapWithinSec) is untrapped', () => {
    const off = ctrl('elec.gen2', false, 3, 1);
    const on = ctrl('elec.gen2', true, 40, 2);
    const h = hist([snap(0), snap(3, { actions: [off] }), snap(40, { actions: [off, on] })]);
    expect(gradeEventSet(def([trap('t', 'minor', 20)]), h, GRACE).grade).toBe(2);
    expect(gradeEventSet(def([trap('t', 'minor')]), h, GRACE).grade).toBe(3);
  });

  it('a pre-error snapshot at the SAME time as the error does not count as the correction', () => {
    // Engine reality: a periodic tick snapshot and a dispatch share clock.now. Snapshot 1 is the
    // pre-error state (GEN 2 still on); snapshot 2 (same t) records the error; GEN 2 stays off.
    const stateTrap: CheckDef = {
      kind: 'errorTrap', id: 't', when: gen2Off, severity: 'major', category: 'systems', reason: 'trap t',
      trappedWhen: { kind: 'state', path: 'elec.gen2.switchOn', op: 'eq', value: true }, trapWithinSec: 20,
    };
    const withGen2 = (t: number, on: boolean, actions: Stamped<PilotAction>[] = []) => {
      const x = snap(t, { actions });
      x.ctx.state = { ...x.ctx.state, elec: { ...x.ctx.state.elec, gen2: { switchOn: on, failed: false } } };
      return x;
    };
    const off = ctrl('elec.gen2', false, 3, 1);
    const h = hist([snap(0), withGen2(3, true), withGen2(3, false, [off]), withGen2(10, false, [off])]);
    expect(gradeEventSet(def([stateTrap]), h, GRACE)).toMatchObject({ grade: 1, reasons: [{ text: 'trap t' }] });
    // A real correction after the error is still recognized.
    const on = ctrl('elec.gen2', true, 8, 2);
    const fixed = hist([snap(0), withGen2(3, true), withGen2(3, false, [off]), withGen2(8, true, [off, on])]);
    expect(gradeEventSet(def([stateTrap]), fixed, GRACE).grade).toBe(2);
  });

  it('a hint in the same instant but after the satisfying snapshot does not make it prompted', () => {
    const hint: Stamped<PilotAction> = { t: 5, seq: 2, body: { kind: 'hint', eventSetId: 'es-a' } };
    const after = hist([snap(0), snap(5, { lights: true }), snap(5, { lights: true, actions: [hint] })], [5]);
    expect(gradeEventSet(def([required('r')]), after, GRACE).grade).toBe(4);
    const before = hist([snap(0), snap(5, { actions: [hint] }), snap(5, { lights: true, actions: [hint] })], [5]);
    expect(gradeEventSet(def([required('r')]), before, GRACE).grade).toBe(2);
  });

  it('poor comm alone -> 3; acceptable and good are ok', () => {
    const d = def([comm()], { startCues: esA.startCues });
    const withReply = (card: string) => hist([snap(0), snap(5, { actions: [rep(card, 5, 1)] })]);
    expect(gradeEventSet(d, withReply('card-no'), GRACE)).toMatchObject({ grade: 3, reasons: [{ category: 'crm', text: 'comm c' }] });
    expect(gradeEventSet(d, withReply('card-yes'), GRACE).grade).toBe(4);
    expect(gradeEventSet(d, withReply('card-ok'), GRACE).grade).toBe(4);
  });

  it('comm quality comes from the first reply; sent but unanswered is poor', () => {
    const d = def([comm()], { startCues: esA.startCues });
    const h = hist([snap(0), snap(9, { actions: [rep('card-yes', 5, 1), rep('card-no', 8, 2)] })]);
    expect(gradeEventSet(d, h, GRACE).grade).toBe(4);
    const swapped = hist([snap(0), snap(9, { actions: [rep('card-yes', 8, 2), rep('card-no', 5, 1)] })]);
    expect(gradeEventSet(d, swapped, GRACE).grade).toBe(3);
    expect(gradeEventSet(d, hist([snap(0), snap(9)]), GRACE).grade).toBe(3);
  });

  it('unsent comm message is skipped', () => {
    const g = gradeEventSet(def([comm()]), hist([snap(0), snap(9)]), GRACE);
    expect(g).toMatchObject({ grade: 4, reasons: [] });
  });

  it('comm sent by a fired rule counts as sent', () => {
    const rule = { id: 'r-send', instructorLabel: 'send', when: { kind: 'atSec', sec: 1 } as Condition, cues: [esA.startCues[0]] };
    const d = def([comm()], { rules: [rule] });
    expect(gradeEventSet(d, hist([snap(0), snap(9, { fired: [['r-send', 1]] })]), GRACE).grade).toBe(3);
    expect(gradeEventSet(d, hist([snap(0), snap(9)]), GRACE).grade).toBe(4);
  });

  it('a reply action alone shows the message was sent', () => {
    const h = hist([snap(0), snap(9, { actions: [rep('card-no', 5, 1)] })]);
    expect(gradeEventSet(def([comm()]), h, GRACE).grade).toBe(3);
  });

  it('max 3 reasons, most severe first, deduped by text', () => {
    const off = ctrl('elec.gen2', false, 3, 1);
    const checks: CheckDef[] = [
      comm(),
      { ...trap('minor-untrapped', 'minor'), reason: 'T-minor' },
      required('late'),
      required('missed'),
      safety('s'),
    ];
    // 'late' and 'missed' share one condition: make 'missed' unsatisfiable.
    checks[3] = { kind: 'required', id: 'missed', when: { kind: 'state', path: 'lights.strobe', op: 'eq', value: true }, withinSec: 5, category: 'procedures', reason: 'req missed' };
    const g = gradeEventSet(
      def(checks, { startCues: esA.startCues }),
      hist([snap(0), snap(3, { actions: [off] }), snap(45, { lights: true, dest: 'dest', actions: [off] })]),
      GRACE,
    );
    expect(g.grade).toBe(1);
    expect(g.reasons.map((r) => r.text)).toEqual(['safety s', 'req missed', 'T-minor']);

    const dup = gradeEventSet(def([safety('a'), { ...safety('b'), reason: 'safety a' }]), hist([snap(0, { dest: 'dest' })]), GRACE);
    expect(dup.reasons).toHaveLength(1);
  });

  it('integration: real engine history for es-a', () => {
    const e = new ScenarioEngine(scenario, { mode: 'auto' });
    e.start();
    e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    e.tick(3);
    e.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    const g = gradeEventSet(scenario.eventSets[0], e.historyFor('es-a'), scenario.latenessGraceSec);
    expect(g).toMatchObject({ eventSetId: 'es-a', grade: 4, reasons: [], hintUsed: false });
  });
});
