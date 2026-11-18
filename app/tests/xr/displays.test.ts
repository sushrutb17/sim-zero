import { describe, expect, it } from 'vitest';
import { Object3D, Scene, Quaternion, Vector3 } from '@iwsdk/core';
import type { AircraftState } from '../../src/contracts/aircraft';
import type { WorldCue } from '../../src/contracts/events';
import { RedrawGate } from '../../src/xr/displays/redrawGate';
import {
  ackAlert,
  alertsReducer,
  drawAlerts,
  highestUnacked,
  orderAlerts,
  AlertsModel,
  type ActiveAlert,
} from '../../src/xr/displays/alerts';
import { drawPfd } from '../../src/xr/displays/pfd';
import { destinationLabel, drawNd, relativeBearing } from '../../src/xr/displays/nd';
import { busStatus, genOnline } from '../../src/xr/cockpit/overhead';
import { Magnifier, magnifyPose, MAGNIFY_DISTANCE_M, MAGNIFY_SCALE } from '../../src/xr/displays/magnify';
import { AUX_PADS, LOCAL, PAD_RECTS, ZONES, padRectsByZone } from '../../src/xr/cockpit/layout';
import { THEME } from '../../src/xr/theme';
import { demoStep, initialDemoState } from '../../src/xr/displays/demo';

const alert = (id: string, level: ActiveAlert['level'], acked = false): ActiveAlert => ({ id, level, text: id.toUpperCase(), acked });
const cue = (id: string, level: 'warning' | 'caution' | 'advisory', text = 'X'): WorldCue => ({ kind: 'alert', id, level, text });

describe('alerts model', () => {
  it('alert list orders warning > caution > advisory then newest first', () => {
    let list: ActiveAlert[] = [];
    for (const [id, lv] of [['a1', 'advisory'], ['c1', 'caution'], ['w1', 'warning'], ['c2', 'caution'], ['w2', 'warning'], ['a2', 'advisory']] as const)
      list = alertsReducer(list, cue(id, lv));
    expect(orderAlerts(list).map((a) => a.id)).toEqual(['w2', 'w1', 'c2', 'c1', 'a2', 'a1']);
  });

  it('alert cue adds, same id replaces, alertClear removes', () => {
    let list = alertsReducer([], cue('gen1-fail', 'warning', 'GEN 1 FAIL'));
    expect(list).toEqual([{ id: 'gen1-fail', level: 'warning', text: 'GEN 1 FAIL', acked: false }]);
    list = alertsReducer(list, cue('gen1-fail', 'caution', 'GEN 1 OFF'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ level: 'caution', text: 'GEN 1 OFF', acked: false });
    list = alertsReducer(list, { kind: 'alertClear', id: 'gen1-fail' });
    expect(list).toEqual([]);
    expect(alertsReducer([], { kind: 'alertClear', id: 'nope' })).toEqual([]);
  });

  it('re-sending an identical alert keeps its acked state; unrelated cues leave the list alone', () => {
    let list = alertsReducer([], cue('w', 'warning', 'T'));
    list = ackAlert(list, 'w');
    expect(alertsReducer(list, cue('w', 'warning', 'T'))[0].acked).toBe(true);
    const same = alertsReducer(list, { kind: 'checklistAvailable', checklistId: 'x' });
    expect(same).toBe(list);
  });

  it('reducer never mutates its input', () => {
    const list = Object.freeze([Object.freeze(alert('a', 'caution'))]) as ActiveAlert[];
    expect(() => alertsReducer(list, cue('b', 'warning'))).not.toThrow();
    expect(() => ackAlert(list, 'a')).not.toThrow();
    expect(list[0].acked).toBe(false);
  });

  it('ack marks one alert acked; highestUnacked picks highest priority then newest', () => {
    let list: ActiveAlert[] = [];
    list = alertsReducer(list, cue('c1', 'caution'));
    list = alertsReducer(list, cue('w1', 'warning'));
    list = alertsReducer(list, cue('w2', 'warning'));
    expect(highestUnacked(list)?.id).toBe('w2');
    list = ackAlert(list, 'w2');
    expect(list.find((a) => a.id === 'w2')!.acked).toBe(true);
    expect(highestUnacked(list)?.id).toBe('w1');
    list = ackAlert(ackAlert(list, 'w1'), 'c1');
    expect(highestUnacked(list)).toBeUndefined();
    expect(ackAlert(list, 'missing')).toBe(list);
  });
});

describe('electrical derivation', () => {
  const gen = (switchOn: boolean, failed = false) => ({ switchOn, failed });
  it('gen online derived as switchOn && !failed', () => {
    expect(genOnline(gen(true, false))).toBe(true);
    expect(genOnline(gen(true, true))).toBe(false);
    expect(genOnline(gen(false, false))).toBe(false);
    expect(genOnline(gen(false, true))).toBe(false);
  });
  it('bus powered by its own generator, or by the other via the bus tie', () => {
    const e = (g1: ReturnType<typeof gen>, g2: ReturnType<typeof gen>, busTie: boolean) => ({ gen1: g1, gen2: g2, backupGenInop: false, busTie });
    expect(busStatus(e(gen(true), gen(true), false))).toEqual({ bus1: true, bus2: true });
    expect(busStatus(e(gen(true, true), gen(true), false))).toEqual({ bus1: false, bus2: true });
    expect(busStatus(e(gen(true, true), gen(true), true))).toEqual({ bus1: true, bus2: true });
    expect(busStatus(e(gen(true, true), gen(false), true))).toEqual({ bus1: false, bus2: false });
    expect(busStatus(e(gen(true), gen(true, true), false))).toEqual({ bus1: true, bus2: false });
  });
});

describe('RedrawGate', () => {
  it('canvas panel redraws only when dirty and at most 10 Hz', () => {
    const g = new RedrawGate(100);
    expect(g.shouldRedraw(0)).toBe(true); // initial paint
    expect(g.shouldRedraw(50)).toBe(false); // clean
    g.markDirty();
    expect(g.shouldRedraw(60)).toBe(false); // dirty, but <100 ms since last draw
    expect(g.shouldRedraw(99)).toBe(false);
    expect(g.shouldRedraw(100)).toBe(true);
    expect(g.shouldRedraw(250)).toBe(false); // consumed
    let draws = 0;
    for (let t = 300; t < 1300; t += 5) {
      g.markDirty();
      if (g.shouldRedraw(t)) draws++;
    }
    expect(draws).toBeLessThanOrEqual(10);
    expect(draws).toBeGreaterThanOrEqual(9);
  });
});

describe('magnify', () => {
  it('magnify toggles and restores original transform', () => {
    const scene = new Scene();
    const zone = new Object3D();
    zone.position.set(-0.25, 0.92, -0.5);
    zone.rotation.set(-0.4, 0.3, 0, 'YXZ');
    scene.add(zone);
    const panel = new Object3D();
    panel.position.set(0, 0, 0.0006);
    panel.scale.set(1, 1, 1);
    zone.add(panel);
    scene.updateMatrixWorld(true);
    const before = { p: panel.position.clone(), q: panel.quaternion.clone(), s: panel.scale.clone() };

    const head = new Object3D();
    head.position.set(0.05, 1.2, 0.02);
    head.rotation.set(-0.2, 0.15, 0, 'YXZ');
    scene.add(head);
    head.updateMatrixWorld(true);

    const m = new Magnifier(scene, head);
    m.register('pfd', panel);
    expect(m.isMagnified('pfd')).toBe(false);
    expect(m.toggle('pfd')).toBe(true);
    expect(panel.parent).toBe(scene);
    expect(panel.scale.x).toBeCloseTo(MAGNIFY_SCALE);
    const want = magnifyPose(head.getWorldPosition(new Vector3()), head.getWorldQuaternion(new Quaternion()));
    expect(panel.position.distanceTo(want.position)).toBeLessThan(1e-6);
    expect(panel.position.distanceTo(head.getWorldPosition(new Vector3()))).toBeCloseTo(MAGNIFY_DISTANCE_M, 6);
    expect(m.toggle('pfd')).toBe(false);
    expect(panel.parent).toBe(zone);
    expect(panel.position.toArray()).toEqual(before.p.toArray());
    expect(panel.quaternion.toArray()).toEqual(before.q.toArray());
    expect(panel.scale.toArray()).toEqual(before.s.toArray());
  });

  it('magnified panel keeps depth testing (hands draw over it) and toggling another display restores the first', () => {
    const scene = new Scene();
    const head = new Object3D();
    scene.add(head);
    const mk = () => {
      const o = new Object3D();
      scene.add(o);
      return o;
    };
    const a = mk();
    const b = mk();
    const m = new Magnifier(scene, head);
    m.register('pfd', a);
    m.register('nd', b);
    m.toggle('pfd');
    m.toggle('nd');
    expect(m.isMagnified('pfd')).toBe(false);
    expect(m.isMagnified('nd')).toBe(true);
    expect(m.toggle('alerts')).toBe(false); // not registered: no-op
  });
});

describe('layout of Task 9 pads', () => {
  it('ACK pad sits in the reserved right end of the autopilot strip and is covered by the pad tests', () => {
    const ack = AUX_PADS['alerts.ack'];
    expect(ack.zone).toBe('autopilot');
    const rightmostTask8 = Math.max(...Object.entries(PAD_RECTS).flatMap(([id, rs]) => rs!.map(([dx, , w]) => LOCAL[id as keyof typeof LOCAL][0] + dx + w / 2)));
    expect(ack.center[0] - ack.size[0] / 2 - rightmostTask8).toBeGreaterThanOrEqual(0.012 - 1e-9);
    expect(ack.center[0] + ack.size[0] / 2).toBeLessThanOrEqual(ZONES.autopilot.size[0] / 2);
    expect(Math.min(...ack.size)).toBeGreaterThanOrEqual(THEME.control.minHitM);
    const all = padRectsByZone();
    expect(all.autopilot.some(([cx]) => cx === ack.center[0])).toBe(true);
    for (const k of ['pfd', 'nd', 'alerts'] as const) expect(all[k]).toHaveLength(1);
  });
});

/** A recording 2D context: no real canvas needed. */
function fakeCtx(w = 456, h = 384) {
  const texts: string[] = [];
  const target: Record<string, unknown> = { canvas: { width: w, height: h }, texts };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 8 });
      if (k === 'fillText') return (s: string) => void texts.push(s);
      return () => undefined;
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const state = (over: Partial<AircraftState> = {}): AircraftState => ({
  altitudeFt: 12000, headingDeg: 120, speedKt: 250, phase: 'climb',
  ap: { engaged: true, hdg: 120, alt: 12000, lateral: 'hdg', vertical: 'climb' },
  baroHpa: 1013, lights: { landing: false, strobe: true },
  elec: { gen1: { switchOn: true, failed: true }, gen2: { switchOn: true, failed: false }, backupGenInop: true, busTie: false },
  comFreq: '118.65', destination: 'dest', stormBearingDeg: 150, ...over,
});

describe('display drawing (recorded, ASCII only)', () => {
  it('PFD shows speed, altitude, heading and active AP modes in plain ASCII', () => {
    const { ctx, texts } = fakeCtx();
    drawPfd(ctx, state());
    const all = texts.join('|');
    expect(all).toContain('250');
    expect(all).toContain('12000');
    expect(all).toContain('120');
    expect(all).toContain('HDG');
    expect(all).toContain('CLB');
    expect(all).toContain('AP');
    for (const t of texts) expect(/^[\x20-\x7e]*$/.test(t), t).toBe(true);
  });
  it('PFD heading is zero-padded and follows the state', () => {
    const { ctx, texts } = fakeCtx();
    drawPfd(ctx, state({ headingDeg: 90 }));
    expect(texts).toContain('090');
  });
  it('relative storm bearing wraps to -180..180 against heading', () => {
    expect(relativeBearing(150, 120)).toBe(30);
    expect(relativeBearing(10, 350)).toBe(20);
    expect(relativeBearing(350, 10)).toBe(-20);
  });
  it('ND draws without text outside ASCII, with and without a storm', () => {
    for (const storm of [null, 150]) {
      const { ctx, texts } = fakeCtx(528, 384);
      drawNd(ctx, state({ stormBearingDeg: storm }));
      for (const t of texts) expect(/^[\x20-\x7e]*$/.test(t), t).toBe(true);
    }
  });
  it('alerts display lists alerts and the generator status line', () => {
    const { ctx, texts } = fakeCtx();
    drawAlerts(ctx, [alert('gen1-fail', 'warning'), alert('cabin', 'advisory', true)], state().elec);
    const all = texts.join('|');
    expect(all).toContain('GEN1-FAIL');
    expect(all).toContain('CABIN');
    expect(all).toContain('GEN 1 FAULT');
    expect(all).not.toContain('GEN 1 FAIL');
    expect(all).toContain('GEN 2 ON');
    for (const t of texts) expect(/^[\x20-\x7e]*$/.test(t), t).toBe(true);
  });
});

describe('dev demo timeline', () => {
  it('climbs 0 to 12000 ft, heading 090 to 120, storm during climb, gen1 alert fires once at 10000 ft', () => {
    const s = initialDemoState();
    let fires = 0;
    let firedAlt = 0;
    for (let t = 0; t <= 60; t += 0.1) {
      if (demoStep(s, t)) {
        fires++;
        firedAlt = s.altitudeFt;
      }
      if (t < 3.9) expect(s.altitudeFt).toBe(0);
      if (t > 15 && t < 25) expect(s.stormBearingDeg).not.toBeNull();
    }
    expect(fires).toBe(1);
    expect(firedAlt).toBeGreaterThanOrEqual(10000);
    expect(s.altitudeFt).toBeCloseTo(12000, 0);
    expect(s.headingDeg).toBeCloseTo(120, 5);
    expect(s.elec.gen1.failed).toBe(true);
  });
});

describe('Task 9 fix round 1', () => {
  it('ACK glow predicate: lit only while a warning is unacknowledged', () => {
    const m = new AlertsModel();
    expect(m.hasUnackedWarning()).toBe(false);
    m.apply(cue('c', 'caution'));
    expect(m.hasUnackedWarning()).toBe(false);
    m.apply(cue('w', 'warning'));
    expect(m.hasUnackedWarning()).toBe(true);
    expect(m.ackHighest()).toBe('w');
    expect(m.hasUnackedWarning()).toBe(false);
  });

  it('resetAlerts clears the list and notifies (redraw); can seed a list', () => {
    const m = new AlertsModel();
    let redraws = 0;
    m.onChange = () => redraws++;
    m.apply(cue('w', 'warning'));
    expect(redraws).toBe(1);
    m.reset();
    expect(m.list).toEqual([]);
    expect(redraws).toBe(2);
    m.reset([alert('x', 'advisory')]);
    expect(m.list.map((a) => a.id)).toEqual(['x']);
    expect(redraws).toBe(3);
    m.reset(); // resetting an already empty list still redraws
    expect(redraws).toBe(4);
  });

  it('destination label: upper-cased scenario name; unknown id is blank, never the raw id', () => {
    const names = { dest: 'Harrowmere', dep: 'Quillby Fell' };
    expect(destinationLabel(names, 'dest')).toBe('HARROWMERE');
    expect(destinationLabel(names, 'alt1')).toBe('');
    expect(destinationLabel(names, 'toString')).toBe('');
    const { ctx, texts } = fakeCtx(528, 384);
    drawNd(ctx, state({ destination: 'alt1' }), destinationLabel(names, 'alt1'));
    expect(texts.join('|')).not.toContain('alt1');
    expect(texts.join('|')).not.toContain('TO ');
    const r = fakeCtx(528, 384);
    drawNd(r.ctx, state(), destinationLabel(names, 'dest'));
    expect(r.texts).toContain('TO HARROWMERE');
  });

  it('close tab follows the magnified panel corner (still under its zone); pressing it restores everything', () => {
    const scene = new Scene();
    const zone = new Object3D();
    zone.position.set(-0.25, 0.92, -0.5);
    zone.rotation.set(-0.4, 0.3, 0, 'YXZ');
    scene.add(zone);
    const panel = new Object3D();
    panel.position.set(0, 0, 0.0008);
    zone.add(panel);
    const tab = new Object3D();
    tab.position.set(0.0775, 0.06, 0.006);
    zone.add(tab);
    const head = new Object3D();
    head.position.set(0, 1.2, 0);
    scene.add(head);
    scene.updateMatrixWorld(true);
    const before = { p: tab.position.toArray(), q: tab.quaternion.toArray(), s: tab.scale.toArray() };
    const m = new Magnifier(scene, head);
    m.register('pfd', panel, tab);
    const onTabPress = () => m.toggle('pfd'); // what the tab pad's handler does
    onTabPress();
    expect(m.isMagnified('pfd')).toBe(true);
    expect(tab.parent).toBe(zone); // never reparented (ECS pad entity)
    scene.updateMatrixWorld(true);
    // the tab sits at the panel's top-right corner, scaled 1.6x, in front of the panel plane
    const corner = new Vector3(0.0775 * MAGNIFY_SCALE, 0.06 * MAGNIFY_SCALE, (0.006 - 0.0008) * MAGNIFY_SCALE).applyQuaternion(panel.quaternion).add(panel.position);
    expect(tab.getWorldPosition(new Vector3()).distanceTo(corner)).toBeLessThan(1e-6);
    expect(tab.getWorldScale(new Vector3()).x).toBeCloseTo(MAGNIFY_SCALE, 6);
    onTabPress();
    expect(m.isMagnified('pfd')).toBe(false);
    expect(tab.position.toArray()).toEqual(before.p);
    expect(tab.quaternion.toArray()).toEqual(before.q);
    expect(tab.scale.toArray()).toEqual(before.s);
    expect(panel.parent).toBe(zone);
  });

  it('demo and test fixtures use coined ids and no four-letter codes', () => {
    expect(initialDemoState().destination).toBe('dest');
    expect(initialDemoState().comFreq).toBe('118.65');
  });
});
