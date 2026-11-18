import { describe, expect, it } from 'vitest';
import type { PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import type { ControlId } from '../../src/contracts/aircraft';
import { parseScenario } from '../../src/contracts/scenario';
import { TrainingSession } from '../../src/engine/session';
import singleSource from '../../src/scenarios/single-source';
import { miniScenario } from '../fixtures/mini-scenario';

const reply: PilotAction = { kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' };
const lights: PilotAction = { kind: 'control', controlId: 'lights.landing', value: true };
const toDep: PilotAction = { kind: 'control', controlId: 'route.destination', value: 'dep' };
const mk = () => {
  const s = new TrainingSession(parseScenario(structuredClone(miniScenario)), { mode: 'auto' });
  const cues: Stamped<WorldCue>[] = [];
  s.onCue((c) => cues.push(c));
  s.start();
  return { s, cues };
};
const finish = (s: TrainingSession) => {
  s.engine.tick(3);
  s.engine.dispatch(reply);
  s.engine.tick(2);
  s.engine.dispatch(lights);
  s.engine.dispatch(toDep);
};
const kinds = (cues: Stamped<WorldCue>[]) => cues.map((c) => c.body.kind);

describe('TrainingSession', () => {
  it('grades every event set at scenario end', () => {
    const { s } = mk();
    let ended = 0;
    s.onEnded(() => ended++);
    finish(s);
    expect(ended).toBe(1);
    const r = s.results();
    expect(r.original.map((g) => g.eventSetId)).toEqual(['es-a', 'es-b']);
    expect(r.original.every((g) => g.source === 'auto')).toBe(true);
    expect(r.redo).toBeUndefined();
  });

  it('redo replays only that set and returns redo grade alongside original', () => {
    const { s } = mk();
    finish(s);
    const before = s.results().original;
    const endedResults: ReturnType<TrainingSession['results']>[] = [];
    s.onEnded((r) => endedResults.push(r));
    s.redo('es-a');
    expect(s.engine.status).toMatchObject({ run: 'running', eventSetId: 'es-a' });
    expect(s.engine.actionsFor('es-a')).toEqual([]);
    s.engine.dispatch(reply);
    s.engine.dispatch(lights); // good redo
    expect(s.engine.status.run).toBe('ended');
    expect(s.engine.status.endReason).toBeUndefined();
    const r = s.results();
    expect(r.original).toEqual(before);
    expect(r.redo?.eventSetId).toBe('es-a');
    expect(r.redo?.grade.eventSetId).toBe('es-a');
    expect(r.redo?.grade.source).toBe('auto');
    expect(endedResults).toHaveLength(1);
    expect(endedResults[0].redo).toBeDefined();
  });

  it('second redo replaces first redo result', () => {
    const { s } = mk();
    finish(s);
    s.redo('es-a');
    s.engine.dispatch(reply);
    s.engine.dispatch(lights);
    expect(s.results().redo?.eventSetId).toBe('es-a');
    s.redo('es-b');
    expect(s.results().redo).toBeUndefined();
    s.engine.dispatch(toDep);
    expect(s.results().redo?.eventSetId).toBe('es-b');
  });

  it('restart clears pending rules', () => {
    const { s, cues } = mk();
    s.engine.tick(3);
    s.engine.dispatch(reply); // r-a-chain pending (+2 s)
    const old = s.engine;
    s.restart();
    expect(s.engine).not.toBe(old);
    const n = cues.length;
    s.engine.tick(1);
    expect(cues.slice(n).filter((c) => c.body.kind === 'aircraft')).toEqual([]);
    expect(s.results().original).toEqual([]);
    s.engine.tick(1.5);
    expect(cues.slice(n).filter((c) => c.body.kind === 'aircraft')).toEqual([]);
  });

  it('instructor override sets source instructor and comment', () => {
    const { s } = mk();
    finish(s);
    const orig = s.results().original[0];
    s.overrideGrade('es-a', 4, 'Well handled');
    const g = s.results().original[0];
    expect(g).toMatchObject({ grade: 4, source: 'instructor', comment: 'Well handled', reasons: orig.reasons });
    s.redo('es-a');
    s.engine.dispatch(reply);
    s.engine.dispatch(lights);
    expect(s.results().original[0].source).toBe('instructor');
    expect(s.results().redo?.grade.source).toBe('auto');
    expect(() => s.overrideGrade('nope', 1, 'x')).toThrow();
  });

  it('redo before scenario end throws', () => {
    const { s } = mk();
    expect(() => s.redo('es-a')).toThrow('redo only after scenario end');
    finish(s);
    expect(() => s.redo('unknown')).toThrow();
  });

  it('redo of an endWhen-completed set emits eventSet end and no scenarioEnd', () => {
    const { s, cues } = mk();
    finish(s);
    const n = cues.length;
    s.redo('es-a');
    s.engine.dispatch(reply);
    s.engine.dispatch(lights);
    const fresh = cues.slice(n);
    expect(fresh.some((c) => c.body.kind === 'eventSet' && c.body.status === 'end')).toBe(true);
    expect(kinds(fresh)).not.toContain('scenarioEnd');
    const seqs = cues.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('onCue subscription survives restart', () => {
    const { s, cues } = mk();
    s.restart();
    const n = cues.length;
    expect(n).toBeGreaterThan(2);
    expect(cues.slice(2, n).some((c) => c.body.kind === 'eventSet')).toBe(true);
    const actions: Stamped<PilotAction>[] = [];
    s.onAction((a) => actions.push(a));
    s.restart();
    s.engine.dispatch(reply);
    expect(actions).toHaveLength(1);
  });

  it('snapshotAt is not overwritten by a redo re-entry', () => {
    const { s } = mk();
    finish(s);
    const snap = s.engine.snapshotAt('es-b');
    s.redo('es-b');
    const first = { state: structuredClone(s.engine.state), now: s.engine.snapshotAt('es-b').clockNow };
    s.engine.dispatch(toDep);
    s.redo('es-b');
    expect(s.engine.state).toEqual(first.state);
    expect(s.engine.snapshotAt('es-b')).toEqual(snap);
    expect(s.engine.snapshotAt('es-b').clockNow).toBe(first.now);
  });

  it('redo of the last set ends only via endCondition, not its endWhen', () => {
    const raw = structuredClone(miniScenario) as any;
    raw.eventSets[1].endWhen = { kind: 'atSec', sec: 2 };
    const s = new TrainingSession(parseScenario(raw), { mode: 'auto' });
    const cues: Stamped<WorldCue>[] = [];
    s.onCue((c) => cues.push(c));
    s.start();
    finish(s);
    expect(s.engine.status.endReason).toBe('diversionSetUp');
    s.redo('es-b');
    const n = cues.length;
    s.engine.tick(3);
    expect(s.engine.status.run).toBe('running');
    expect(cues.slice(n).some((c) => c.body.kind === 'eventSet' && c.body.status === 'end')).toBe(false);
    s.engine.dispatch(toDep);
    expect(s.engine.status).toMatchObject({ run: 'ended', endReason: 'diversionSetUp' });
    expect(s.results().redo?.eventSetId).toBe('es-b');
  });

  it('setPatience applies from the first tick, survives restart, and can be reset', () => {
    const s = new TrainingSession(parseScenario(structuredClone(miniScenario)), { mode: 'auto' });
    s.setPatience(2);
    s.start();
    s.engine.tick(4);
    expect(s.engine.status.tInSet).toBeCloseTo(2);
    s.restart();
    expect(s.engine.patience).toBe(2);
    s.engine.tick(4);
    expect(s.engine.status.tInSet).toBeCloseTo(2);
    s.setPatience(1);
    expect(s.engine.patience).toBe(1);
    s.restart();
    expect(s.engine.patience).toBe(1);
  });
  it('results().reviews has a timeline for each graded set after the scenario ends', () => {
    const { s } = mk();
    expect(s.results().reviews).toEqual({});
    finish(s);
    const r = s.results();
    expect(Object.keys(r.reviews).sort()).toEqual(['es-a', 'es-b']);
    expect(r.reviews['es-a'].entries.map((e) => e.text)).toEqual(
      expect.arrayContaining(['ATC: Message A1', 'REPLY TO ATC: Yes', 'LAND ON']),
    );
    expect(r.reviews['es-b'].entries.map((e) => e.text)).toContain('DESTINATION Departure Placeholder');
  });

  it('a redo keeps the first attempt review and adds its own; restart clears both', () => {
    const { s } = mk();
    finish(s);
    const first = structuredClone(s.results().reviews['es-a']);
    s.redo('es-a');
    s.engine.dispatch({ kind: 'control', controlId: 'ap.hdg', value: 77 }); // only in the redo
    s.engine.dispatch(reply);
    s.engine.dispatch(lights);
    const r = s.results();
    expect(r.redo?.eventSetId).toBe('es-a');
    const redoTexts = r.redo!.review.entries.map((e) => e.text);
    expect(redoTexts).toContain('HDG 077');
    expect(r.reviews['es-a']).toEqual(first);
    expect(r.reviews['es-a'].entries.map((e) => e.text)).not.toContain('HDG 077');
    s.restart();
    const cleared = s.results();
    expect(cleared.reviews).toEqual({});
    expect(cleared.redo).toBeUndefined();
  });

  it('a second redo replaces the first redo review', () => {
    const { s } = mk();
    finish(s);
    s.redo('es-a');
    s.engine.dispatch(reply);
    s.engine.dispatch(lights);
    expect(s.results().redo?.review.entries.map((e) => e.text)).toContain('REPLY TO ATC: Yes');
    s.redo('es-b');
    expect(s.results().redo).toBeUndefined();
    s.engine.dispatch(toDep);
    expect(s.results().redo?.eventSetId).toBe('es-b');
    expect(s.results().redo?.review.entries.map((e) => e.text)).toContain('DESTINATION Departure Placeholder');
  });

  it('Single Source: the Event Set 3 review carries three electrical moments, Event Set 4 none', () => {
    const s = new TrainingSession(singleSource, { mode: 'auto' });
    const seen = new Set<string>();
    s.onCue((c) => {
      if (c.body.kind === 'message' || c.body.kind === 'alert') seen.add(c.body.id);
    });
    s.start();
    const e = s.engine;
    const ctl = (controlId: ControlId, value: number | boolean | string) => e.dispatch({ kind: 'control', controlId, value });
    const tick = (sec: number) => {
      for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
    };
    const until = (pred: () => boolean) => {
      for (let t = 0; !pred(); t += 0.1) {
        if (t > 240 || e.status.run !== 'running') throw new Error('timed out');
        e.tick(0.1);
      }
    };
    const reply = (messageId: string, cardId: string) => e.dispatch({ kind: 'reply', messageId, cardId });
    const item = (checklistId: string, itemId: string) => e.dispatch({ kind: 'checklistItem', checklistId, itemId });
    tick(2);
    reply('twr-hold', 'hold-readback');
    ctl('baro.set', 1004); ctl('ap.hdg', 90); ctl('ap.alt', 4000); ctl('lights.landing', true); ctl('lights.strobe', true);
    tick(2);
    for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) item('beforeTakeoff', id);
    until(() => e.status.eventSetId === 'es2-takeoff-climb');
    tick(2);
    reply('twr-takeoff', 'to-readback');
    until(() => seen.has('dep-climb'));
    reply('dep-climb', 'dev-left');
    ctl('ap.engage', true); ctl('ap.alt', 12000); ctl('ap.vertical', 'climb'); ctl('ap.hdg', 60);
    until(() => e.status.eventSetId === 'es3-gen-failure');
    tick(1);
    reply('dep-handoff', 'ho-readback');
    until(() => seen.has('gen1-fail'));
    tick(2);
    e.dispatch({ kind: 'alertAck', alertId: 'gen1-fail' });
    tick(1);
    item('genFail', 'gf-identify');
    ctl('elec.gen1', false);
    item('genFail', 'gf-gen1-off');
    ctl('elec.busTie', true);
    for (const id of ['gf-bustie', 'gf-cabin', 'gf-review']) item('genFail', id);
    until(() => seen.has('cab-lights'));
    reply('cab-lights', 'cab-standby');
    until(() => seen.has('ctr-query'));
    reply('ctr-query', 'ctr-report');
    until(() => e.status.eventSetId === 'es4-decision');
    until(() => seen.has('ctr-intentions'));
    tick(3);
    reply('ctr-intentions', 'dec-return');
    tick(3);
    ctl('route.destination', 'dep');
    tick(2);
    ctl('pa.cabin', true);
    until(() => seen.has('pa-cabin'));
    reply('pa-cabin', 'pa-clear');
    expect(e.status.run).toBe('ended');
    const r = s.results();
    expect(r.reviews['es3-gen-failure'].elec?.map((m) => m.label)).toEqual(['START', 'AT FAULT', 'END']);
    expect(r.reviews['es4-decision'].elec).toBeNull();
    expect(r.reviews['es1-before-takeoff'].elec).toBeNull();
  });
});
