import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_VALUE_SCHEMAS } from '../../src/contracts/aircraft';
import { PilotActionSchema } from '../../src/contracts/events';
import { EventBus } from '../../src/bus/eventBus';
import {
  DEBOUNCE_MS,
  GuardedToggleLogic,
  PressDebouncer,
  StepperLogic,
  OptionLogic,
  ToggleLogic,
} from '../../src/xr/controls/controlLogic';
import { HEAD_ANCHOR, LAYOUT, MAX_REACH_M, LOCAL, PAD_RECTS, ZONES, commsGeo, distanceFromAnchor, localToRelative, padRectsByZone, PANEL_PADS } from '../../src/xr/cockpit/layout';
import { THEME } from '../../src/xr/theme';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PressDebouncer', () => {
  it('debounces repeated press within 250 ms', () => {
    vi.setSystemTime(1_000_000);
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.onAction((a) => seen.push(a));
    const deb = new PressDebouncer(() => Date.now());
    const toggle = new ToggleLogic(false);
    for (let i = 0; i < 3; i++) {
      if (deb.accept()) bus.emitAction({ kind: 'control', controlId: 'lights.landing', value: toggle.press() });
      vi.advanceTimersByTime(40); // 3 presses within ~100 ms
    }
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(deb.accept()).toBe(true);
  });

  it('does not extend the window with ignored presses', () => {
    vi.setSystemTime(5_000);
    const deb = new PressDebouncer(() => Date.now());
    expect(deb.accept()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(deb.accept()).toBe(false);
    vi.advanceTimersByTime(60); // 260 ms since the accepted press
    expect(deb.accept()).toBe(true);
  });
});

describe('StepperLogic', () => {
  it('stepper wraps heading 359→0', () => {
    const s = new StepperLogic({ step: 10, min: 0, max: 359, wrap: true, initial: 355 });
    expect(s.press(+1)).toBe(5);
    expect(s.press(-1)).toBe(355);
    const t = new StepperLogic({ step: 10, min: 0, max: 359, wrap: true, initial: 0 });
    expect(t.press(-1)).toBe(350);
  });

  it('heading reaches 060/090/120 from 000 in 10-degree steps', () => {
    const s = new StepperLogic({ step: 10, min: 0, max: 359, wrap: true, initial: 0 });
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) seen.add(s.press(+1) as number);
    expect([60, 90, 120].every((v) => seen.has(v))).toBe(true);
  });

  it('stepper clamps altitude to max', () => {
    const s = new StepperLogic({ step: 1000, min: 0, max: 41000, initial: 40000 });
    expect(s.press(+1)).toBe(41000);
    expect(s.press(+1)).toBe(41000); // clamped: still a press, emits the clamped value
    expect(s.value).toBe(41000);
    const lo = new StepperLogic({ step: 1000, min: 0, max: 41000, initial: 0 });
    expect(lo.press(-1)).toBe(0);
  });

  it('altitude reaches 4000 and 12000; baro goes 1013 → 1004', () => {
    const alt = new StepperLogic({ step: 1000, min: 0, max: 41000, initial: 10000 });
    alt.press(+1);
    expect(alt.press(+1)).toBe(12000);
    const alt2 = new StepperLogic({ step: 1000, min: 0, max: 41000, initial: 10000 });
    for (let i = 0; i < 6; i++) alt2.press(-1);
    expect(alt2.value).toBe(4000);
    const baro = new StepperLogic({ step: 1, min: 950, max: 1050, initial: 1013 });
    for (let i = 0; i < 9; i++) baro.press(-1);
    expect(baro.value).toBe(1004);
  });

  it('setValue changes the displayed value without producing a press', () => {
    const s = new StepperLogic({ step: 10, min: 0, max: 359, wrap: true, initial: 0 });
    s.setValue(270);
    expect(s.value).toBe(270);
    expect(s.press(+1)).toBe(280);
  });

  it('emitted values satisfy the contract schemas', () => {
    const hdg = new StepperLogic({ step: 10, min: 0, max: 359, wrap: true, initial: 355 });
    for (let i = 0; i < 40; i++) {
      const v = hdg.press(+1) as number;
      expect(CONTROL_VALUE_SCHEMAS['ap.hdg'].safeParse(v).success).toBe(true);
    }
    const act = PilotActionSchema.safeParse({ kind: 'control', controlId: 'baro.set', value: 1004 });
    expect(act.success).toBe(true);
  });
});

describe('GuardedToggleLogic', () => {
  it('guarded toggle needs open then press', () => {
    const g = new GuardedToggleLogic(false);
    expect(g.guardOpen).toBe(false);
    expect(g.press()).toEqual({ emit: false, guardOpen: true });
    expect(g.press()).toEqual({ emit: true, value: true, guardOpen: false });
    // guard closes after the toggle: needs to be opened again
    expect(g.press().emit).toBe(false);
    expect(g.press()).toEqual({ emit: true, value: false, guardOpen: false });
  });
  it('setValue does not open the guard', () => {
    const g = new GuardedToggleLogic(false);
    g.setValue(true);
    expect(g.guardOpen).toBe(false);
    expect(g.value).toBe(true);
  });
});

describe('OptionLogic', () => {
  it('option selector cycles values', () => {
    const o = new OptionLogic(['hdg', 'nav'], 'hdg');
    expect(o.cycle()).toBe('nav');
    expect(o.cycle()).toBe('hdg');
    expect(o.select(1)).toBe('nav');
    expect(o.value).toBe('nav');
  });
  it('rejects unknown options in setValue', () => {
    const o = new OptionLogic(['climb', 'hold'], 'climb');
    o.setValue('hold');
    expect(o.value).toBe('hold');
    expect(() => o.setValue('nope')).not.toThrow();
    expect(o.value).toBe('hold');
  });
});

describe('LAYOUT', () => {
  it('every LAYOUT entry within 0.65 m of anchor', () => {
    expect(HEAD_ANCHOR).toEqual([0, 1.2, 0]);
    for (const [id, e] of Object.entries(LAYOUT)) {
      expect(distanceFromAnchor(e.pos), id).toBeLessThanOrEqual(MAX_REACH_M);
    }
  });

  it('has every control built in Task 8 and every zone', () => {
    const keys: string[] = [
      'ap.hdg', 'ap.alt', 'baro.set', 'ap.engage', 'ap.lateral', 'ap.vertical',
      'lights.landing', 'lights.strobe', 'elec.gen1', 'elec.gen2', 'elec.busTie', 'practice.toggle',
      'pfd', 'nd', 'alerts', 'checklist', 'comms', 'route', 'kneeboard',
    ];
    for (const k of keys) expect(LAYOUT, k).toHaveProperty(k);
  });

  it('every control hit area is at least 3.5 cm', () => {
    for (const [zone, rects] of Object.entries(padRectsByZone())) {
      for (const [, , w, h] of rects) expect(Math.min(w, h), zone).toBeGreaterThanOrEqual(THEME.control.minHitM);
    }
  });

  it('every pair of pads in the same zone has an edge-to-edge gap of at least 12 mm', () => {
    for (const [zone, rects] of Object.entries(padRectsByZone())) {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [ax, ay, aw, ah] = rects[i];
          const [bx, by, bw, bh] = rects[j];
          const gx = Math.abs(ax - bx) - (aw + bw) / 2;
          const gy = Math.abs(ay - by) - (ah + bh) / 2;
          // rectangles are separated by the larger axis gap (negative = overlap on that axis)
          expect(Math.max(gx, gy), `${zone} pads ${i}/${j}`).toBeGreaterThanOrEqual(0.012 - 1e-9);
        }
      }
    }
  });

  it('keeps all pads inside their zone face', () => {
    for (const [zone, rects] of Object.entries(padRectsByZone())) {
      const [zw, zh] = ZONES[zone as keyof typeof ZONES].size;
      for (const [cx, cy, w, h] of rects) {
        expect(Math.abs(cx) + w / 2, zone).toBeLessThanOrEqual(zw / 2);
        expect(Math.abs(cy) + h / 2, zone).toBeLessThanOrEqual(zh / 2);
      }
    }
  });

  it('zone panels do not intersect each other (sampled, 5 mm clearance)', () => {
    const keys = Object.keys(ZONES) as (keyof typeof ZONES)[];
    const samples = (k: keyof typeof ZONES) => {
      const z = ZONES[k];
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++)
        pts.push([...localToRelative(z, (i / 8 - 0.5) * z.size[0], (j / 8 - 0.5) * z.size[1])] as [number, number, number]);
      return pts;
    };
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      const pa = samples(keys[a]);
      const pb = samples(keys[b]);
      let min = Infinity;
      for (const p of pa) for (const q of pb) min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      expect(min, `${keys[a]} vs ${keys[b]}`).toBeGreaterThan(0.005);
    }
  });

  it('line of sight: from the anchor no zone (face + 12 mm bezel) is hidden by another zone', () => {
    const B = 0.012;
    const keys = Object.keys(ZONES) as (keyof typeof ZONES)[];
    const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const frame = (k: keyof typeof ZONES) => {
      const z = ZONES[k];
      const o = z.pos;
      return { z, o, ex: sub(localToRelative(z, 1, 0), o), ey: sub(localToRelative(z, 0, 1), o), n: sub(localToRelative(z, 0, 0, 1), o) };
    };
    const frames = Object.fromEntries(keys.map((k) => [k, frame(k)])) as Record<string, ReturnType<typeof frame>>;
    // ray from the anchor (origin) towards p; returns t (hit at t*p) on zone k's plane if inside its rect + bezel
    const hit = (k: string, p: readonly number[]) => {
      const f = frames[k];
      const den = dot(f.n, p);
      if (Math.abs(den) < 1e-9) return null;
      const t = dot(f.n, f.o) / den;
      if (t <= 0) return null;
      const r = sub([p[0] * t, p[1] * t, p[2] * t], f.o);
      return Math.abs(dot(r, f.ex)) <= f.z.size[0] / 2 + B && Math.abs(dot(r, f.ey)) <= f.z.size[1] / 2 + B ? t : null;
    };
    const N = 24;
    for (const k of keys) {
      const z = ZONES[k];
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const lx = (i / N - 0.5) * (z.size[0] + 2 * B);
        const ly = (j / N - 0.5) * (z.size[1] + 2 * B);
        const p = localToRelative(z, lx, ly, 0.0005);
        for (const k2 of keys) {
          if (k2 === k) continue;
          const t = hit(k2, p);
          expect(t !== null && t < 0.999, `${k} sample (${lx.toFixed(3)},${ly.toFixed(3)}) hidden by ${k2}`).toBe(false);
        }
      }
    }
  });

  it('Task 10 route rows and PA button sit inside their zones with >= 12 mm between pads', () => {
    // route.destination: four >= 40 mm rows in the route zone; pa.cabin: top-left of the comms zone
    const cells = PAD_RECTS['route.destination']!;
    expect(cells).toHaveLength(4);
    const [rx, ry] = LOCAL['route.destination'];
    const [zw, zh] = ZONES.route.size;
    for (const [dx, dy, w, h] of cells) {
      expect(h, 'route row height').toBeGreaterThanOrEqual(0.04 - 1e-9);
      expect(w, 'route row width').toBeGreaterThanOrEqual(THEME.control.minHitM);
      expect(Math.abs(rx + dx) + w / 2).toBeLessThanOrEqual(zw / 2);
      expect(Math.abs(ry + dy) + h / 2).toBeLessThanOrEqual(zh / 2);
    }
    const [px, py] = LOCAL['pa.cabin'];
    const [pw, ph] = PAD_RECTS['pa.cabin']![0].slice(2);
    const [cw, ch] = ZONES.comms.size;
    expect(Math.abs(px) + pw / 2).toBeLessThanOrEqual(cw / 2);
    expect(Math.abs(py) + ph / 2).toBeLessThanOrEqual(ch / 2);
    expect(ph).toBeGreaterThanOrEqual(THEME.control.minHitM - 1e-9);
  });

  it('comms message/card area clears the pad row above it by >= 12 mm and stays inside the zone', () => {
    const g = commsGeo();
    const rowBottom = g.row.cy - g.row.h / 2;
    expect(rowBottom - g.content.top).toBeGreaterThanOrEqual(0.012 - 1e-9);
    expect(g.content.top).toBeLessThanOrEqual(g.H / 2);
    expect(g.content.bottom).toBeGreaterThanOrEqual(-g.H / 2);
    // PA and the page pads share the top row without touching: >= 12 mm between every pair
    const rects = [g.pa, ...g.dots].sort((a, b) => a.cx - b.cx);
    for (let i = 1; i < rects.length; i++) expect(rects[i].cx - rects[i].w / 2 - (rects[i - 1].cx + rects[i - 1].w / 2)).toBeGreaterThanOrEqual(0.012 - 1e-9);
    for (const d of g.dots) expect(Math.abs(d.cx) + d.w / 2).toBeLessThanOrEqual(g.W / 2);
  });

  it('pedestal panels are at least 0.2 m tall; route and checklist sit 20-35 deg below eye level, comms 50-56 deg (steeper, so its 0.29 m face clears the display row)', () => {
    const pitch = (k: 'checklist' | 'comms' | 'route') => {
      const z = LAYOUT[k];
      return (Math.atan2(-z.pos[1], Math.hypot(z.pos[0], z.pos[2])) * 180) / Math.PI;
    };
    for (const k of ['checklist', 'comms', 'route'] as const) expect(LAYOUT[k].size[1], k).toBeGreaterThanOrEqual(0.2);
    for (const k of ['checklist', 'route'] as const) {
      expect(pitch(k), k).toBeGreaterThanOrEqual(20);
      expect(pitch(k), k).toBeLessThanOrEqual(35);
    }
    expect(pitch('comms')).toBeGreaterThanOrEqual(50);
    expect(pitch('comms')).toBeLessThanOrEqual(56);
  });

  it('comms panel bottom edge is at most 70 degrees below eye level', () => {
    const z = ZONES.comms;
    let worst = 0;
    for (const sx of [-1, 0, 1]) {
      const p = localToRelative(z, (sx * z.size[0]) / 2, -z.size[1] / 2);
      worst = Math.max(worst, (Math.atan2(-p[1], Math.hypot(p[0], p[2])) * 180) / Math.PI);
    }
    expect(worst).toBeLessThanOrEqual(70);
  });

  it('EVERY panel pad stays within 55 degrees of straight ahead and 0.65 m of the head anchor (seated comfort)', () => {
    const rel = (zone: keyof typeof ZONES, cx: number, cy: number) => localToRelative(ZONES[zone], cx, cy, 0);
    const checkPad = (label: string, zone: keyof typeof ZONES, cx: number, cy: number) => {
      const p = rel(zone, cx, cy);
      const yaw = (Math.atan2(p[0], -p[2]) * 180) / Math.PI;
      expect(Math.abs(yaw), `${label} yaw ${yaw.toFixed(1)}`).toBeLessThanOrEqual(55);
      expect(distanceFromAnchor(p), `${label} reach`).toBeLessThanOrEqual(MAX_REACH_M);
    };
    const byZone = padRectsByZone(); // control pads, Task 9 aux pads, and PANEL_PADS (page pads, checklist rows/arrows, kneeboard buttons)
    let n = 0;
    for (const z of ['comms', 'checklist', 'route', 'kneeboard'] as const) {
      for (const [cx, cy] of byZone[z] ?? []) {
        checkPad(`${z} pad (${cx.toFixed(3)}, ${cy.toFixed(3)})`, z, cx, cy);
        n++;
      }
    }
    expect(n).toBeGreaterThan(15);
    // the dynamic reply cards are full-width pads in the comms content area: check its top and bottom centres
    const g = commsGeo();
    checkPad('comms first card', 'comms', 0, g.content.top - 0.02);
    checkPad('comms last card', 'comms', 0, g.content.bottom + 0.02);
    for (const [id, a] of Object.entries(PANEL_PADS)) checkPad(id, a.zone, a.center[0], a.center[1]);
  });

  it('tilts text-bearing panels toward the anchor (kneeboard and pedestal)', () => {
    for (const k of ['kneeboard', 'checklist', 'comms', 'route'] as const) {
      expect(LAYOUT[k].rotX ?? 0, k).not.toBe(0);
    }
  });
});
