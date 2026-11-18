import { describe, expect, it } from 'vitest';
import type { ControlId } from '../../src/contracts/aircraft';
import type { SetHistory } from '../../src/engine/conditions';
import { busStatus, elecCaption, elecMoments, genOnline, type Elec } from '../../src/engine/power';
import { TrainingSession } from '../../src/engine/session';
import { buildTimeline } from '../../src/engine/timeline';
import singleSource from '../../src/scenarios/single-source';

const gen = (switchOn: boolean, failed = false) => ({ switchOn, failed });
const elec = (g1: ReturnType<typeof gen>, g2: ReturnType<typeof gen>, busTie: boolean, backupGenInop = false): Elec => ({
  gen1: g1,
  gen2: g2,
  backupGenInop,
  busTie,
});

// --- Single Source drivers (a trimmed copy of the helpers in tests/engine/timeline.test.ts) ---

function single() {
  const s = new TrainingSession(singleSource, { mode: 'auto' });
  const seen = new Set<string>();
  s.onCue((c) => {
    if (c.body.kind === 'message' || c.body.kind === 'alert') seen.add(c.body.id);
  });
  s.start();
  const e = s.engine;
  const ctl = (controlId: ControlId, value: number | boolean | string) => e.dispatch({ kind: 'control', controlId, value });
  const reply = (messageId: string, cardId: string) => e.dispatch({ kind: 'reply', messageId, cardId });
  const item = (checklistId: string, itemId: string) => e.dispatch({ kind: 'checklistItem', checklistId, itemId });
  const ack = (alertId: string) => e.dispatch({ kind: 'alertAck', alertId });
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
  };
  const until = (what: string, pred: () => boolean, maxSec = 240) => {
    let t = 0;
    while (!pred()) {
      if (t > maxSec || e.status.run !== 'running') throw new Error(`timed out waiting for ${what}`);
      e.tick(0.1);
      t += 0.1;
    }
  };
  const waitFor = (id: string) => until(`cue ${id}`, () => seen.has(id));
  const inSet = (id: string) => until(`set ${id}`, () => e.status.eventSetId === id);
  return { s, e, ctl, reply, item, ack, tick, waitFor, inSet };
}
type Single = ReturnType<typeof single>;

function es1Good(r: Single) {
  r.tick(2);
  r.reply('twr-hold', 'hold-readback');
  r.ctl('baro.set', 1004);
  r.ctl('ap.hdg', 90);
  r.ctl('ap.alt', 4000);
  r.ctl('lights.landing', true);
  r.ctl('lights.strobe', true);
  r.tick(2);
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) r.item('beforeTakeoff', id);
  r.inSet('es2-takeoff-climb');
}
function es2Good(r: Single) {
  r.tick(2);
  r.reply('twr-takeoff', 'to-readback');
  r.waitFor('dep-climb');
  r.reply('dep-climb', 'dev-left');
  r.ctl('ap.engage', true);
  r.ctl('ap.alt', 12000);
  r.ctl('ap.vertical', 'climb');
  r.ctl('ap.hdg', 60);
  r.inSet('es3-gen-failure');
}
function es3Good(r: Single) {
  r.tick(1);
  r.reply('dep-handoff', 'ho-readback');
  r.waitFor('gen1-fail');
  r.tick(2);
  r.ack('gen1-fail');
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
  r.inSet('es4-decision');
}
function toEs4(r: Single) {
  es1Good(r);
  es2Good(r);
  es3Good(r);
  r.waitFor('ctr-intentions');
  r.tick(3);
}

describe('genOnline and busStatus (moved from the overhead panel, behaviour unchanged)', () => {
  it('gen online derived as switchOn && !failed', () => {
    expect(genOnline(gen(true, false))).toBe(true);
    expect(genOnline(gen(true, true))).toBe(false);
    expect(genOnline(gen(false, false))).toBe(false);
    expect(genOnline(gen(false, true))).toBe(false);
  });
  it('bus powered by its own generator, or by the other via the bus tie', () => {
    expect(busStatus(elec(gen(true), gen(true), false))).toEqual({ bus1: true, bus2: true });
    expect(busStatus(elec(gen(true, true), gen(true), false))).toEqual({ bus1: false, bus2: true });
    expect(busStatus(elec(gen(true, true), gen(true), true))).toEqual({ bus1: true, bus2: true });
    expect(busStatus(elec(gen(true, true), gen(false), true))).toEqual({ bus1: false, bus2: false });
    expect(busStatus(elec(gen(true), gen(true, true), false))).toEqual({ bus1: true, bus2: false });
  });
  it('the overhead module still re-exports both', async () => {
    const o = await import('../../src/xr/cockpit/overhead');
    expect(o.genOnline).toBe(genOnline);
    expect(o.busStatus).toBe(busStatus);
  });
});

describe('elecCaption', () => {
  it('both generators online, whatever the bus tie', () => {
    const want = 'Both generators online. Each bus has its own source.';
    expect(elecCaption(elec(gen(true), gen(true), false))).toBe(want);
    expect(elecCaption(elec(gen(true), gen(true), true, true))).toBe(want);
  });
  it('GEN 2 only with the bus tie on: backup inoperative, then backup available', () => {
    expect(elecCaption(elec(gen(false), gen(true), true, true))).toBe('GEN 2 powers both buses through the bus tie. No backup generator remains.');
    expect(elecCaption(elec(gen(true, true), gen(true), true, false))).toBe('GEN 2 powers both buses through the bus tie.');
  });
  it('one generator with the bus tie off names the unpowered bus', () => {
    expect(elecCaption(elec(gen(false), gen(true), false))).toBe('GEN 2 powers BUS 2 only. BUS 1 has no power.');
    expect(elecCaption(elec(gen(true), gen(true, true), false, true))).toBe('GEN 1 powers BUS 1 only. BUS 2 has no power.');
  });
  it('GEN 1 only with the bus tie on mirrors GEN 2', () => {
    expect(elecCaption(elec(gen(true), gen(false), true, true))).toBe('GEN 1 powers both buses through the bus tie. No backup generator remains.');
  });
  it('no generator online', () => {
    expect(elecCaption(elec(gen(false), gen(true, true), true))).toBe('No generator online. Both buses have no power.');
  });
  it('every caption is printable ASCII', () => {
    for (const a of [false, true])
      for (const b of [false, true])
        for (const fa of [false, true])
          for (const fb of [false, true])
            for (const tie of [false, true])
              for (const inop of [false, true])
                expect(elecCaption(elec(gen(a, fa), gen(b, fb), tie, inop))).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe('elecMoments', () => {
  it('an empty history gives null', () => {
    expect(elecMoments({ snapshots: [], hintTimes: [] })).toBeNull();
  });

  it('no electrical change gives null', () => {
    const r = single();
    r.tick(5);
    expect(elecMoments(r.e.historyFor('es1-before-takeoff'))).toBeNull();
  });

  it('Single Source Event Set 3 happy path gives START, AT FAULT, END', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    es3Good(r);
    const m = elecMoments(r.e.historyFor('es3-gen-failure'))!;
    expect(m.map((x) => x.label)).toEqual(['START', 'AT FAULT', 'END']);
    const [start, fault, end] = m;
    expect(start.tSec).toBe(0);
    expect(start.elec.gen1).toEqual({ switchOn: true, failed: false });
    expect(start.elec.gen2).toEqual({ switchOn: true, failed: false });
    expect(start.elec.busTie).toBe(false);
    expect(fault.elec.gen1.failed).toBe(true);
    expect(fault.elec.busTie).toBe(false);
    expect(fault.tSec).toBeGreaterThan(0);
    expect(end.tSec).toBeGreaterThan(fault.tSec);
    expect(end.elec.gen1.switchOn).toBe(false);
    expect(end.elec.gen2.switchOn).toBe(true);
    expect(end.elec.busTie).toBe(true);
    expect(elecCaption(end.elec)).toBe('GEN 2 powers both buses through the bus tie. No backup generator remains.');
  });

  it('the AT FAULT time matches the moment the timeline shows the fault alert (no snapshot shows the fault earlier)', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    es3Good(r);
    const def = singleSource.eventSets.find((x) => x.id === 'es3-gen-failure')!;
    const history = r.e.historyFor('es3-gen-failure');
    const alert = buildTimeline(singleSource, def, history).find((x) => x.text === 'ALERT: GEN 1 FAULT')!;
    const fault = elecMoments(history)!.find((x) => x.label === 'AT FAULT')!;
    expect(fault.tSec).toBeGreaterThanOrEqual(alert.tSec - 1e-9);
    expect(fault.tSec - alert.tSec).toBeLessThan(0.5);
  });

  it('switches cycled with no failure gives START and END only', () => {
    const r = single();
    r.tick(1);
    r.ctl('elec.busTie', true);
    r.tick(1);
    r.ctl('elec.busTie', false);
    es1Good(r);
    const m = elecMoments(r.e.historyFor('es1-before-takeoff'))!;
    expect(m.map((x) => x.label)).toEqual(['START', 'END']);
    expect(m[0].tSec).toBe(0);
    expect(m[0].elec.busTie).toBe(false);
    expect(m[1].elec.busTie).toBe(false);
    expect(m[1].tSec).toBeGreaterThan(2);
  });

  it('Single Source Event Set 4 gives null', () => {
    const r = single();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-return');
    r.tick(3);
    r.ctl('route.destination', 'dep');
    expect(elecMoments(r.e.historyFor('es4-decision'))).toBeNull();
  });

  it('a failure already present at the start gives START and END only', () => {
    const e = elec(gen(true, true), gen(true), false);
    const snap = (t: number, el: Elec) => ({ t, ctx: { tInSet: t, state: { elec: el } as never, actions: [], fired: new Map(), now: t } });
    const h: SetHistory = { snapshots: [snap(0, e), snap(5, { ...e, busTie: true })], hintTimes: [] };
    expect(elecMoments(h)!.map((x) => x.label)).toEqual(['START', 'END']);
  });

  it('moments are copies: changing one does not change the history', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    es3Good(r);
    const history = r.e.historyFor('es3-gen-failure');
    const before = structuredClone(history.snapshots.map((s) => s.ctx.state.elec));
    const m = elecMoments(history)!;
    for (const x of m) {
      x.elec.gen1.switchOn = !x.elec.gen1.switchOn;
      x.elec.busTie = !x.elec.busTie;
      x.elec.backupGenInop = !x.elec.backupGenInop;
    }
    expect(history.snapshots.map((s) => s.ctx.state.elec)).toEqual(before);
  });
});
