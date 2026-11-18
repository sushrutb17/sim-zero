// Task 16 step 2: text readability guard. For every surface that shows text, work out the smallest cap height and the
// largest eye distance of that text, and require a visual angle theta = 2 * atan(cap / (2 d)) >= 0.66 deg
// (docs/design/visual-direction.md section 4: 0.70 deg at the 0.6 m design distance, 0.661 deg accepted at the 0.65 m
// far limit; 0.66-0.70 deg is "marginal"). Everything is computed from code and data, no renderer:
//   - canvas displays and trainer screens: the REAL draw functions run against a recording 2D context (font size,
//     alignment and position of every fillText; widths from the real Inter advances), then mapped through ZONES/SCREENS;
//   - UIKitML label panels: the generated public/ui/*.uikitml files are parsed (UIKit units are centimetres);
//   - the four World-bound panels (checklist, comms, route, kneeboard) cannot be drawn without a World, so their text
//     regions come from the layout helpers (conservative: whole regions, not the actual line ends).
// The eye is the origin of relative layout space (HEAD_ANCHOR). EMULATOR-FREE and device-free: this proves geometry and
// sizes, not how MSDF or canvas text looks in a Quest. Set READABILITY_TABLE=1 to print the table.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inter } from '@pmndrs/msdfonts';
import { singleSource } from '../../src/scenarios/single-source';
import type { AircraftState } from '../../src/contracts/aircraft';
import { THEME } from '../../src/xr/theme';
import {
  AUX_PADS,
  PANEL_PADS,
  PAD_RECTS,
  ROUTE_CELL_SIZE,
  ZONES,
  commsGeo,
  kneeboardGeo,
  localToRelative,
  routeGeo,
  type LayoutEntry,
} from '../../src/xr/cockpit/layout';
import { PX_PER_M } from '../../src/xr/displays/drawUtil';
import { drawPfd } from '../../src/xr/displays/pfd';
import { destinationLabel, drawNd } from '../../src/xr/displays/nd';
import { drawAlerts, type ActiveAlert } from '../../src/xr/displays/alerts';
import { drawOverheadStrip } from '../../src/xr/cockpit/overhead';
import { MAGNIFY_DISTANCE_M, MAGNIFY_SCALE } from '../../src/xr/displays/magnify';
import { ZoneCanvas } from '../../src/xr/panels/draw';
import { SCREENS, SMALL_BUTTONS, debriefGeo, redoRect } from '../../src/app/screens/layout';
import { welcomeScreen } from '../../src/app/screens/welcome';
import { setSoundOff } from '../../src/app/soundState';
import { modeSelectScreen } from '../../src/app/screens/modeSelect';
import { flightSelectScreen } from '../../src/app/screens/flightSelect';
import { FLIGHTS, type FlightDef } from '../../src/scenarios/registry';
import { FLIGHT_A, FLIGHT_B, FLIGHT_C } from '../app/flightFixtures';
import { practiceScreen } from '../../src/app/screens/practice';
import { briefingScreen } from '../../src/app/screens/briefing';
import { pausedScreen, finishedScreen } from '../../src/app/screens/status';
import { drawCoach } from '../../src/app/screens/coach';
import { drawDebrief, layoutDebrief } from '../../src/app/screens/debrief';
import type { DebriefRow } from '../../src/app/debriefModel';
import { REASON_LABELS } from '../../src/contracts/events';
import type { SmallScreen } from '../../src/app/screens/ui';

const PASS_DEG = 0.66;
const MARGINAL_DEG = 0.7;
const DEG = 180 / Math.PI;
/** theta of a cap height seen from d (the doc's formula). */
const thetaDeg = (cap: number, d: number): number => 2 * Math.atan(cap / (2 * d)) * DEG;

// ---------------------------------------------------------------------------------------------------------------------
// text facts
// ---------------------------------------------------------------------------------------------------------------------
interface Fact {
  surface: string;
  /** What the text is (first/longest sample). */
  text: string;
  capM: number;
  /** Largest eye distance over the text's extent corners (m). */
  distM: number;
  /** Same corner, but the visual angle of the cap segment itself (includes tilt of the face away from the eye). */
  obliqueDeg: number;
  deg: number;
}

type V3 = readonly [number, number, number];
const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angleBetween = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)))));

/** Fact for a text whose extent is the zone-local box [x0,x1] x [y0,y1] with cap height capM, on face `z`. */
function fact(surface: string, text: string, z: LayoutEntry, x0: number, x1: number, y0: number, y1: number, capM: number, lz = 0): Fact {
  let distM = 0;
  let oblique = Infinity;
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      const p = localToRelative(z, x, y, lz);
      if (len(p) < distM) continue;
      distM = len(p);
      const top = localToRelative(z, x, y + capM / 2, lz);
      const bot = localToRelative(z, x, y - capM / 2, lz);
      oblique = angleBetween(top, bot) * DEG;
    }
  }
  return { surface, text, capM, distM, obliqueDeg: oblique, deg: thetaDeg(capM, distM) };
}

// ---------------------------------------------------------------------------------------------------------------------
// recording 2D context (real draw code, fake canvas)
// ---------------------------------------------------------------------------------------------------------------------
const advances = (face: typeof inter.medium) => {
  const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
  return (t: string) => [...t].reduce((a, ch) => a + (adv.get(ch) ?? adv.get('n')!), 0) / face.info.size;
};
const mediumEm = advances(inter.medium);
const boldEm = advances(inter.bold);
/** Text width in metres for a cap height and weight (Inter advances; no extra slack). */
const widthM = (t: string, capM: number, weight = 500) => (weight >= 600 ? boldEm(t) : mediumEm(t)) * (capM / THEME.text.capToEm);

interface Rec {
  s: string;
  /** Canvas px from the top-left. */
  x: number;
  y: number;
  fontPx: number;
  weight: number;
  align: CanvasTextAlign;
}

function recorder(wM: number, hM: number) {
  const recs: Rec[] = [];
  const state = { font: '600 10px Inter', textAlign: 'left' as CanvasTextAlign };
  const parse = () => {
    const m = /^(\d+) ([\d.]+)px/.exec(state.font)!;
    return { weight: Number(m[1]), fontPx: Number(m[2]) };
  };
  const target: Record<string, unknown> = { canvas: { width: Math.round(wM * PX_PER_M), height: Math.round(hM * PX_PER_M) } };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k === 'font' || k === 'textAlign') return state[k];
      if (k in t) return t[k];
      if (k === 'measureText') {
        return (s: string) => {
          const { weight, fontPx } = parse();
          return { width: (weight >= 600 ? boldEm(s) : mediumEm(s)) * fontPx };
        };
      }
      if (k === 'fillText') return (s: string, x: number, y: number) => void recs.push({ s, x, y, ...parse(), align: state.textAlign });
      return () => undefined;
    },
    set(t, k: string, v) {
      if (k === 'font' || k === 'textAlign') (state as Record<string, unknown>)[k] = v;
      else t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, recs };
}

/** Facts for every recorded text; (cx0, cy0) is the canvas centre in zone-local metres. */
function factsOf(surface: string, z: LayoutEntry, recs: Rec[], wM: number, hM: number, cx0 = 0, cy0 = 0): Fact[] {
  return recs.map((r) => {
    const capM = (r.fontPx / PX_PER_M) * THEME.text.capToEm;
    const w = (r.weight >= 600 ? boldEm(r.s) : mediumEm(r.s)) * (r.fontPx / PX_PER_M);
    const xm = r.x / PX_PER_M;
    const left = r.align === 'right' ? xm - w : r.align === 'center' ? xm - w / 2 : xm;
    const ym = r.y / PX_PER_M;
    const lx0 = left - wM / 2 + cx0;
    const lx1 = left + w - wM / 2 + cx0;
    const ly = hM / 2 - ym + cy0;
    return fact(surface, r.s, z, lx0, lx1, ly - capM / 2, ly + capM / 2, capM);
  });
}

function drawOnCanvas(draw: (ctx: CanvasRenderingContext2D) => void, wM: number, hM: number) {
  const { ctx, recs } = recorder(wM, hM);
  draw(ctx);
  return recs;
}

/** A ZoneCanvas on the recording context (the class's constructor needs a DOM canvas; its methods do not). */
function drawOnZone(draw: (zc: ZoneCanvas) => void, W: number, H: number) {
  const { ctx, recs } = recorder(W, H);
  const zc = Object.create(ZoneCanvas.prototype) as ZoneCanvas & Record<string, unknown>;
  Object.assign(zc, { W, H, ctx, px: (x: number) => (x + W / 2) * PX_PER_M, py: (y: number) => (H / 2 - y) * PX_PER_M });
  draw(zc);
  return recs;
}

// ---------------------------------------------------------------------------------------------------------------------
// surface table
// ---------------------------------------------------------------------------------------------------------------------
const state: AircraftState = {
  altitudeFt: 12000, headingDeg: 120, speedKt: 250, phase: 'climb',
  ap: { engaged: true, hdg: 120, alt: 12000, lateral: 'hdg', vertical: 'climb' },
  baroHpa: 1013, lights: { landing: false, strobe: true },
  elec: { gen1: { switchOn: true, failed: true }, gen2: { switchOn: true, failed: false }, backupGenInop: true, busTie: false },
  comFreq: '118.65', destination: 'dest', stormBearingDeg: 150,
};

function alertCues(): ActiveAlert[] {
  const out: ActiveAlert[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (r.kind === 'alert' && typeof r.text === 'string') out.push({ id: String(r.id), level: r.level as ActiveAlert['level'], text: r.text, acked: false });
      Object.values(r).forEach(walk);
    }
  };
  walk(singleSource);
  return out;
}

const airportLabels = Object.fromEntries(singleSource.airports.map((a) => [a.id, a.name]));
const byScreen = (screen: SmallScreen, flights: readonly FlightDef[] = FLIGHTS, flight: FlightDef = flights[0]) => (zc: ZoneCanvas) =>
  screen.draw(zc, { scenario: singleSource, flights, flight, level: () => 'idle', seatOffset: () => 0.1 });

function debriefRows(worst: boolean): DebriefRow[] {
  return singleSource.eventSets.map((es) => {
    const reasons = worst
      ? [...es.checks].sort((a, b) => b.reason.length - a.reason.length).slice(0, 3).map((c) => ({ label: REASON_LABELS[c.category], text: c.reason }))
      : [];
    return { eventSetId: es.id, title: es.title, technical: es.technical, crm: es.crm, grade: worst ? 1 : 4, hintUsed: worst, reasons, ...(worst ? { redoGrade: 2 as const, redoHintUsed: true, redoReasons: reasons } : {}) };
  });
}
const measureForLayout = (t: string, role: keyof typeof THEME.text.capM, weight: number) => widthM(t, THEME.text.capM[role], weight);

/** Parse a generated UIKitML label panel (units: cm) into facts on zone `key` (the panel covers the zone face). */
function labelPanelFacts(file: string, key: keyof typeof ZONES): Fact[] {
  const xml = readFileSync(new URL(`../../public/ui/${file}`, import.meta.url), 'utf8');
  const [rootW, rootH] = [...xml.matchAll(/^<div style="width: ([\d.]+); height: ([\d.]+)/gm)][0].slice(1).map(Number);
  const z = ZONES[key];
  expect(rootW / 100, `${file} panel width = zone width`).toBeCloseTo(z.size[0], 6);
  expect(rootH / 100, `${file} panel height = zone height`).toBeCloseTo(z.size[1], 6);
  const out: Fact[] = [];
  for (const m of xml.matchAll(/position-left: ([\d.]+); position-top: ([\d.]+); width: ([\d.]+); height: ([\d.]+); text-align: center; font-size: ([\d.]+); font-weight: (\d+);[^>]*>([^<]*)</g)) {
    const [left, top, w, h, fs, fw] = m.slice(1, 7).map(Number);
    const text = m[7];
    const capM = (fs / 100) * THEME.text.capToEm;
    const cx = (left + w / 2 - rootW / 2) / 100;
    const cy = (rootH / 2 - top - h / 2) / 100;
    const tw = widthM(text, capM, fw) * 1.04; // +4% letter spacing
    out.push(fact(file, text, z, cx - tw / 2, cx + tw / 2, cy - capM / 2, cy + capM / 2, capM, 0.0005));
  }
  return out;
}

const surfaces: Array<{ name: string; facts: Fact[] }> = [];
const add = (name: string, facts: Fact[]) => surfaces.push({ name, facts: facts.map((f) => ({ ...f, surface: name })) });

// Canvas displays on their zone faces (canvas = the zone face, origin top-left).
for (const [key, draw] of [
  ['pfd', (c: CanvasRenderingContext2D) => drawPfd(c, state)],
  ['nd', (c: CanvasRenderingContext2D) => Object.keys(airportLabels).forEach((id) => drawNd(c, state, destinationLabel(airportLabels, id)))],
  ['alerts', (c: CanvasRenderingContext2D) => drawAlerts(c, alertCues(), state.elec, true)],
] as const) {
  const [w, h] = ZONES[key].size;
  add(`display ${key} (canvas)`, factsOf(key, ZONES[key], drawOnCanvas(draw, w, h), w, h));
}
// Overhead status strip: 0.5 x 0.018 m canvas at zone-local (0, -0.0685) of the overhead panel.
add('overhead status strip (canvas)', factsOf('strip', ZONES.overhead, drawOnCanvas((c) => drawOverheadStrip(c, state.elec), 0.5, 0.018), 0.5, 0.018, 0, -0.0685));

// Trainer screens (canvas, screen-local metres).
const [sw, sh] = SCREENS.small.size;
for (const [name, screen] of [['welcome', welcomeScreen], ['mode select', modeSelectScreen], ['practice', practiceScreen], ['briefing', briefingScreen], ['paused', pausedScreen], ['finished', finishedScreen]] as const) {
  add(`screen ${name}`, factsOf(name, SCREENS.small, drawOnZone(byScreen(screen), sw, sh), sw, sh));
}
// T49: the welcome screen with the "Sound is off" line (accent, bold) shown.
setSoundOff(true);
add('screen welcome (sound off)', factsOf('welcome sound off', SCREENS.small, drawOnZone(byScreen(welcomeScreen), sw, sh), sw, sh));
setSoundOff(false);
// T41: the flight picker with one, two and three flights (the longest real titles and blurbs), and the mode screen of a flight with no guide.
const pickerFlights: FlightDef[] = [...FLIGHTS, FLIGHT_A, FLIGHT_B, FLIGHT_C].slice(0, 3);
for (const n of [1, 2, 3]) add(`screen flight select (${n})`, factsOf(`flight select ${n}`, SCREENS.small, drawOnZone(byScreen(flightSelectScreen, pickerFlights.slice(0, n)), sw, sh), sw, sh));
add('screen mode select (no guide)', factsOf('mode select no guide', SCREENS.small, drawOnZone(byScreen(modeSelectScreen, [FLIGHT_B], FLIGHT_B), sw, sh), sw, sh));
const [cw, ch] = SCREENS.coach.size;
add('guided coach strip', factsOf('coach', SCREENS.coach, drawOnZone((zc) => drawCoach(zc, { head: 'STEP 12 OF 30 - GENERATOR', body: 'Press the GEN 1 switch to OFF, then check the BUS 1 light on the status strip.' }), cw, ch), cw, ch));
const [lw, lh] = SCREENS.large.size;
{
  const facts: Fact[] = [];
  for (const worst of [false, true]) {
    const rows = debriefRows(worst);
    const layout = layoutDebrief(rows, measureForLayout);
    layout.pages.forEach((_, page) => {
      facts.push(...factsOf('debrief', SCREENS.large, drawOnZone((zc) => drawDebrief(zc, { rows, layout, page, guided: true, level: () => 'idle' }), lw, lh), lw, lh));
    });
  }
  add('screen debrief (all pages)', facts);
}

// Pad labels drawn as canvas textures: ACK and MAG (body, centred on the pad).
for (const id of ['alerts.ack', 'magnify.pfd', 'magnify.nd', 'magnify.alerts'] as const) {
  const p = AUX_PADS[id];
  const label = id === 'alerts.ack' ? 'ACK' : 'MAG';
  const cap = THEME.text.capM.body;
  const tw = widthM(label, cap, 600);
  add(`pad label ${id}`, [fact(id, label, ZONES[p.zone], p.center[0] - tw / 2, p.center[0] + tw / 2, p.center[1] - cap / 2, p.center[1] + cap / 2, cap, 0.006)]);
}

// World-bound canvas panels: regions from the layout helpers (conservative: the whole region at the smallest role used).
{
  const z = ZONES.route;
  const g = routeGeo();
  const cap = THEME.text.capM.min;
  const tw = widthM('DESTINATION', cap, 500);
  add('route panel (DESTINATION, min)', [fact('route', 'DESTINATION', z, g.W / 2 - 0.01 - tw, g.W / 2 - 0.01, g.title.cy - cap / 2, g.title.cy + cap / 2, cap)]);
  const rowCap = THEME.text.capM.body;
  add('route panel rows (body)', [fact('route rows', 'airport names', z, -ROUTE_CELL_SIZE[0] / 2, ROUTE_CELL_SIZE[0] / 2, -g.H / 2, g.H / 2, rowCap)]);
}
{
  const kb = kneeboardGeo();
  const z = ZONES.kneeboard;
  const cap = THEME.text.capM.min;
  const half = kb.W / 2 - 0.01;
  add('kneeboard text, header counter and hint box (min)', [
    fact('kneeboard', 'page text', z, -half, half, kb.text.bottom, kb.text.top, cap),
    fact('kneeboard', 'page counter', z, half - widthM('99/99', cap, 600), half, kb.header.cy - cap / 2, kb.header.cy + cap / 2, cap),
    fact('kneeboard', 'hint box', z, -half, half, kb.hintBox.bottom, kb.hintBox.top, cap),
  ]);
}
{
  const c = commsGeo();
  const cl = ZONES.checklist;
  const body = THEME.text.capM.body;
  add('comms panel (body, whole face)', [fact('comms', 'message, cards, pads', ZONES.comms, -c.W / 2, c.W / 2, -c.H / 2, c.H / 2, body)]);
  add('checklist panel (body, whole face)', [fact('checklist', 'title, items, pads', cl, -cl.size[0] / 2, cl.size[0] / 2, -cl.size[1] / 2, cl.size[1] / 2, body)]);
}

// UIKitML label panels printed on the cockpit panels.
add('label panel overhead (uikitml)', labelPanelFacts('overhead-labels.uikitml', 'overhead'));
add('label panel autopilot (uikitml)', labelPanelFacts('autopilot-labels.uikitml', 'autopilot'));
add('label panel kneeboard (uikitml)', labelPanelFacts('kneeboard-labels.uikitml', 'kneeboard'));

// Magnified displays (MAG tab): the face is brought to 0.45 m in front of the head and scaled 1.6x.
for (const key of ['pfd', 'nd', 'alerts'] as const) {
  const [w, h] = ZONES[key].size;
  const facts = factsOf(key, { pos: [0, 0, -MAGNIFY_DISTANCE_M], size: [w, h] }, drawOnCanvas(key === 'pfd' ? (c) => drawPfd(c, state) : key === 'nd' ? (c) => drawNd(c, state, 'NORTHERN') : (c) => drawAlerts(c, alertCues(), state.elec), w, h), w, h).map((f) => ({
    ...f,
    capM: f.capM * MAGNIFY_SCALE,
    distM: Math.hypot(MAGNIFY_DISTANCE_M, MAGNIFY_SCALE * Math.sqrt(Math.max(0, f.distM ** 2 - MAGNIFY_DISTANCE_M ** 2))),
  }));
  // The magnified face is brought square-on to the head, so the tilt-aware angle equals the distance-only one.
  add(`magnified ${key}`, facts.map((f) => ({ ...f, deg: thetaDeg(f.capM, f.distM), obliqueDeg: thetaDeg(f.capM, f.distM) })));
}

/** Surfaces that fail the distance-only rule today, with the measured value. Empty: none fails; see 'marginal' in the table (READABILITY_TABLE=1). */
const KNOWN_FAILS: Record<string, string> = {};

/**
 * Stricter, informational check: the visual angle of the cap segment itself, which also counts how far the face is
 * tilted away from the eye at the text's far corner. Regions of the World-bound panels are whole boxes, so these are
 * conservative. Same rule: measured gaps are `it.fails`, never a loosened threshold.
 */
const KNOWN_OBLIQUE_FAILS: Record<string, string> = {
  'kneeboard text, header counter and hint box (min)': 'hint-box corner: 0.657 deg tilt-aware vs 0.681 deg distance-only; region is the whole box, real hint lines may not reach that corner',
};

const worstOf = (facts: Fact[]) => facts.reduce((a, b) => (b.deg < a.deg ? b : a));
const verdict = (deg: number) => (deg >= MARGINAL_DEG ? 'pass' : deg >= PASS_DEG ? 'marginal' : 'FAIL');

if (process.env.READABILITY_TABLE) {
  const rows = surfaces.map((s) => {
    const w = worstOf(s.facts);
    return { surface: s.name, texts: s.facts.length, 'smallest cap mm': +(Math.min(...s.facts.map((f) => f.capM)) * 1000).toFixed(2), 'worst text': w.text.slice(0, 22), 'cap mm': +(w.capM * 1000).toFixed(2), 'dist m': +w.distM.toFixed(3), 'theta deg': +w.deg.toFixed(3), 'oblique deg': +w.obliqueDeg.toFixed(3), verdict: verdict(w.deg) };
  });
  console.table(rows);
}

// ---------------------------------------------------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------------------------------------------------
describe('text readability: visual angle of the smallest text on every surface', () => {
  it('the helper reproduces the design doc numbers', () => {
    expect(thetaDeg(0.0075, 0.6)).toBeCloseTo(0.716, 2);
    expect(thetaDeg(0.0075, 0.65)).toBeCloseTo(0.661, 3);
    expect(thetaDeg(0.0075, 0.5)).toBeCloseTo(0.859, 3);
  });

  it('the recorder sees real text on every canvas surface (so the audit is not vacuous)', () => {
    for (const s of surfaces) expect(s.facts.length, s.name).toBeGreaterThan(0);
    for (const f of surfaces.flatMap((s) => s.facts)) expect(f.capM, `${f.surface}: ${f.text}`).toBeGreaterThanOrEqual(THEME.text.minHeightM - 1e-6);
  });

  it('no text is smaller than THEME.text.minHeightM (7.5 mm cap) anywhere', () => {
    for (const s of surfaces) for (const f of s.facts) expect(f.capM * 1000, `${s.name}: "${f.text}"`).toBeGreaterThanOrEqual(THEME.text.minHeightM * 1000 - 1e-6);
  });

  it('body text (9 mm) passes 0.66 deg across the whole face of every zone and screen', () => {
    for (const [name, z] of [...Object.entries(ZONES), ...Object.entries(SCREENS)] as [string, LayoutEntry][]) {
      const f = fact(name, 'whole face', z, -z.size[0] / 2, z.size[0] / 2, -z.size[1] / 2, z.size[1] / 2, THEME.text.capM.body);
      expect(f.deg, `${name} far corner ${f.distM.toFixed(3)} m`).toBeGreaterThanOrEqual(PASS_DEG);
    }
  });

  for (const s of surfaces) {
    const w = worstOf(s.facts);
    const label = `${s.name}: smallest-angle text "${w.text}" cap ${(w.capM * 1000).toFixed(1)} mm at ${w.distM.toFixed(3)} m = ${w.deg.toFixed(3)} deg`;
    // Measured gaps are listed in KNOWN_FAILS and run as `it.fails`; PASS_DEG is never loosened.
    const known = KNOWN_FAILS[s.name];
    if (known) it.fails(`${label} [KNOWN GAP: ${known}]`, () => expect(w.deg).toBeGreaterThanOrEqual(PASS_DEG));
    else it(label, () => expect(w.deg).toBeGreaterThanOrEqual(PASS_DEG));
  }
});

describe('text readability: tilt-aware visual angle (stricter, informational)', () => {
  for (const s of surfaces) {
    const w = s.facts.reduce((a, b) => (b.obliqueDeg < a.obliqueDeg ? b : a));
    const label = `${s.name}: "${w.text}" tilt-aware ${w.obliqueDeg.toFixed(3)} deg`;
    const known = KNOWN_OBLIQUE_FAILS[s.name];
    if (known) it.fails(`${label} [KNOWN GAP: ${known}]`, () => expect(w.obliqueDeg).toBeGreaterThanOrEqual(PASS_DEG));
    else it(label, () => expect(w.obliqueDeg).toBeGreaterThanOrEqual(PASS_DEG));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// hit targets
// ---------------------------------------------------------------------------------------------------------------------
describe('hit targets: every interactive pad source is at least THEME.control.minHitM', () => {
  const min = THEME.control.minHitM - 1e-9;
  const sources: Array<[string, number, number]> = [];
  for (const [id, rects] of Object.entries(PAD_RECTS)) rects!.forEach(([, , w, h], i) => sources.push([`control pad ${id}#${i}`, w, h]));
  for (const [id, p] of Object.entries(AUX_PADS)) sources.push([`aux pad ${id}`, p.size[0], p.size[1]]);
  for (const [id, p] of Object.entries(PANEL_PADS)) sources.push([`panel pad ${id}`, p.size[0], p.size[1]]);
  for (const [id, r] of Object.entries(SMALL_BUTTONS)) sources.push([`screen button ${id}`, r.w, r.h]);
  const g = debriefGeo();
  for (const k of ['prev', 'next', 'restart', 'finish'] as const) sources.push([`debrief ${k}`, g[k].w, g[k].h]);
  const redo = redoRect(0);
  sources.push(['debrief redo pad', redo.w, redo.h]);

  it('covers every pad source (a new pad table that is not listed here is a gap)', () => {
    expect(sources.length).toBeGreaterThan(45);
  });
  for (const [name, w, h] of sources) it(`${name}: ${(Math.min(w, h) * 1000).toFixed(0)} mm`, () => expect(Math.min(w, h)).toBeGreaterThanOrEqual(min));
});
