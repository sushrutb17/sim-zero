// Task 11 screens: placement (reach, yaw, line of sight, no intersection), pad sizes/gaps, and debrief text fit at THEME body.
import { describe, expect, it, vi } from 'vitest';
import { inter } from '@pmndrs/msdfonts';
import { REASON_LABELS } from '../../src/contracts/events';
import { singleSource } from '../../src/scenarios/single-source';
import { ZONES, MAX_REACH_M, distanceFromAnchor, localToRelative, type LayoutEntry } from '../../src/xr/cockpit/layout';
import { THEME, fontSizeForCap } from '../../src/xr/theme';
import { BUTTON_H, SCREEN_GAP, SCREEN_MARGIN, SCREENS, AUTO_SOLO, FLIGHT_CARD_H, MAX_FLIGHT_CARDS, SEAT_LABEL_SLOT, SMALL_BUTTONS, debriefGeo, flightCardRects, padPoolSize, redoRect, timelineGeo, timelineRect, type Rect } from '../../src/app/screens/layout';
import { TIMELINE_EMPTY, TIMELINE_FOOT, layoutTimeline, timelinePads, timelineTitle } from '../../src/app/screens/timelineView';
import type { ControlId } from '../../src/contracts/aircraft';
import { TrainingSession } from '../../src/engine/session';
import { buildTimeline, type TimelineEntry } from '../../src/engine/timeline';
import { modeHint, modeSelectScreen } from '../../src/app/screens/modeSelect';
import { DEBRIEF_TITLE, GUIDED_LABEL, debriefPads, guidedLabelX, layoutDebrief, pageLabelRight } from '../../src/app/screens/debrief';
import type { DebriefRow } from '../../src/app/debriefModel';
import { lineHeightM } from '../../src/xr/panels/textLayout';
import { FLIGHT_BLURB_LINES, FLIGHT_CARD_PAD, FLIGHT_SELECT_TITLE, flightMinutes, flightSelectScreen } from '../../src/app/screens/flightSelect';
import { FLIGHTS } from '../../src/scenarios/registry';
import { PRODUCT_NAME, SOUND_OFF_LINE, WELCOME_TITLE, welcomeScreen } from '../../src/app/screens/welcome';
import { FLIGHT_A, FLIGHT_B, FLIGHT_C, TWO_FLIGHTS } from './flightFixtures';
import { pausedScreen } from '../../src/app/screens/status';
import { seatLabel, SEAT_MAX_M, SEAT_STEP_M } from '../../src/xr/seatMath';
import { ELEC_BOX_PAD_X, ELEC_FOOT, ELEC_STRIP_H, drawElecStrip, elecLabels, layoutElecStrip, type ElecBox } from '../../src/app/screens/elecDiagram';
import { elecCaption, elecMoments, type Elec, type ElecMoment } from '../../src/engine/power';
import type { ZoneCanvas } from '../../src/xr/panels/draw';
import type { TextRole } from '../../src/xr/displays/drawUtil';

type V = readonly number[];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const B = 0.012; // cockpit zone bezel

function frame(z: LayoutEntry) {
  const o = z.pos;
  return { z, o, ex: sub(localToRelative(z, 1, 0), o), ey: sub(localToRelative(z, 0, 1), o), n: sub(localToRelative(z, 0, 0, 1), o) };
}
/** Ray from the eye (origin) through p: t at which it crosses z's face (+ margin), or null. */
function hitT(z: LayoutEntry, p: V, margin: number): number | null {
  const f = frame(z);
  const den = dot(f.n, p);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(f.n, f.o) / den;
  if (t <= 0) return null;
  const r = sub([p[0] * t, p[1] * t, p[2] * t], f.o);
  return Math.abs(dot(r, f.ex)) <= z.size[0] / 2 + margin && Math.abs(dot(r, f.ey)) <= z.size[1] / 2 + margin ? t : null;
}
function samples(z: LayoutEntry, margin: number, n = 20): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) pts.push([...localToRelative(z, (i / n - 0.5) * (z.size[0] + 2 * margin), (j / n - 0.5) * (z.size[1] + 2 * margin), 0.0005)]);
  return pts;
}
const zones = Object.entries(ZONES) as [string, LayoutEntry][];

function checkPad(label: string, s: LayoutEntry, r: Rect) {
  expect(Math.min(r.w, r.h), `${label} size`).toBeGreaterThanOrEqual(THEME.control.minHitM);
  expect(Math.abs(r.cx) + r.w / 2, `${label} inside x`).toBeLessThanOrEqual(s.size[0] / 2);
  expect(Math.abs(r.cy) + r.h / 2, `${label} inside y`).toBeLessThanOrEqual(s.size[1] / 2);
  for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = localToRelative(s, r.cx + (dx * r.w) / 2, r.cy + (dy * r.h) / 2, 0);
    const yaw = (Math.atan2(p[0], -p[2]) * 180) / Math.PI;
    expect(Math.abs(yaw), `${label} yaw ${yaw.toFixed(1)}`).toBeLessThanOrEqual(55);
    expect(distanceFromAnchor(p), `${label} reach`).toBeLessThanOrEqual(MAX_REACH_M);
  }
}
function gap(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.cx - b.cx) - (a.w + b.w) / 2, Math.abs(a.cy - b.cy) - (a.h + b.h) / 2);
}

describe('trainer screens placement', () => {
  it('no cockpit zone hides any part of either screen (line of sight from the eye)', () => {
    for (const [key, s] of Object.entries(SCREENS)) {
      for (const p of samples(s, 0)) {
        for (const [zk, z] of zones) {
          const t = hitT(z, p, B);
          expect(t !== null && t < 0.999, `${key} screen point hidden by ${zk}`).toBe(false);
        }
      }
    }
  });

  it('the small screen hides no cockpit zone (kneeboard, instruments stay visible)', () => {
    for (const [zk, z] of zones) {
      for (const p of samples(z, B, 12)) {
        const t = hitT(SCREENS.small, p, 0);
        expect(t !== null && t < 0.999, `${zk} hidden by the small screen`).toBe(false);
      }
    }
  });

  it('the coach strip hides no cockpit zone (kneeboard, instruments stay visible)', () => {
    for (const [zk, z] of zones) {
      for (const p of samples(z, B, 12)) {
        const t = hitT(SCREENS.coach, p, 0);
        expect(t !== null && t < 0.999, `${zk} hidden by the coach strip`).toBe(false);
      }
    }
  });

  it("the coach strip lies inside the small screen's footprint (seen from the head anchor)", () => {
    const f = frame(SCREENS.small);
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = localToRelative(SCREENS.coach, (dx * SCREENS.coach.size[0]) / 2, (dy * SCREENS.coach.size[1]) / 2, 0);
      const t = hitT(SCREENS.small, p, 0);
      expect(t, `coach corner ${dx},${dy} seen through the small screen`).not.toBeNull();
      const r = sub([p[0] * t!, p[1] * t!, p[2] * t!], f.o);
      expect(Math.abs(dot(r, f.ex))).toBeLessThanOrEqual(SCREENS.small.size[0] / 2);
      expect(Math.abs(dot(r, f.ey))).toBeLessThanOrEqual(SCREENS.small.size[1] / 2);
    }
  });

  it('guided and auto buttons do not overlap each other or the CONTINUE button area', () => {
    const { guided, auto, continue: cont } = SMALL_BUTTONS;
    expect(gap(guided, auto)).toBeGreaterThanOrEqual(0.012 - 1e-9);
    expect(gap(guided, cont)).toBeGreaterThanOrEqual(0.012 - 1e-9);
    expect(gap(auto, cont)).toBeGreaterThanOrEqual(0.012 - 1e-9);
  });

  it('both mode-button sub lines fit one line inside their button', () => {
    for (const [id, text] of [['guided', 'The trainer shows each step'], ['auto', 'No guidance, graded as flown']] as const) {
      const w = medium(text, 'body');
      expect(w, `${id} sub line is ${(w * 1000).toFixed(0)} mm of ${(SMALL_BUTTONS[id].w * 1000).toFixed(0)} mm`).toBeLessThanOrEqual(SMALL_BUTTONS[id].w);
      expect(medium(text, 'min')).toBeLessThanOrEqual(w);
    }
    expect(modeSelectScreen.buttons).toEqual(['guided', 'auto']);
  });

  it('a head line plus two body lines fit the coach strip height', () => {
    expect(lineHeightM('min') + 2 * lineHeightM('body') + 2 * SCREEN_MARGIN).toBeLessThanOrEqual(SCREENS.coach.size[1]);
  });

  it('the debrief screen hides neither side panel nor the kneeboard', () => {
    for (const zk of ['checklist', 'route', 'kneeboard'] as const) {
      for (const p of samples(ZONES[zk], 0, 12)) {
        const t = hitT(SCREENS.large, p, 0);
        expect(t !== null && t < 0.999, `${zk} hidden by the debrief screen`).toBe(false);
      }
    }
  });

  it('screens do not intersect cockpit zones (sampled, 2 cm clearance)', () => {
    for (const [key, s] of Object.entries(SCREENS)) {
      const ps = samples(s, 0, 10);
      for (const [zk, z] of zones) {
        let min = Infinity;
        for (const p of ps) for (const q of samples(z, B, 10)) min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        expect(min, `${key} vs ${zk}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('every small-screen button is >= 35 mm, inside its screen, within 55 deg yaw and 0.65 m reach', () => {
    for (const [id, r] of Object.entries(SMALL_BUTTONS)) checkPad(id, SCREENS.small, r);
    // consecutive screens do not put a button under the finger that pressed the previous one
    expect(gap(SMALL_BUTTONS.continue, SMALL_BUTTONS.auto)).toBeGreaterThanOrEqual(0.012);
  });

  it('debrief pads: sizes, reach/yaw and >= 12 mm gaps on every page (worst-case content)', () => {
    const g = debriefGeo();
    for (const r of [g.prev, g.next, g.restart, g.finish]) checkPad('header', SCREENS.large, r);
    for (const rows of [happyRows(), worstRows()]) {
      const lay = layoutDebrief(rows, measure);
      lay.pages.forEach((_, page) => {
        const shown = debriefPads(rows, lay, page);
        const pads = [...shown, ...[{ id: 'prev', rect: g.prev }, { id: 'next', rect: g.next }].filter((p) => !shown.some((q) => q.id === p.id))];
        for (const p of pads) checkPad(p.id, SCREENS.large, p.rect);
        for (let i = 0; i < pads.length; i++)
          for (let j = i + 1; j < pads.length; j++) expect(gap(pads[i].rect, pads[j].rect), `${pads[i].id}/${pads[j].id}`).toBeGreaterThanOrEqual(0.012 - 1e-9);
      });
    }
  });
});

// ---- debrief text fit with the real Inter advance widths (same estimator as the Task 10 panel tests) ----
const widthIn = (face: typeof inter.medium) => {
  const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
  return (t: string, role: TextRole) => ([...t].reduce((a, ch) => a + (adv.get(ch) ?? adv.get('n')!), 0) / face.info.size) * fontSizeForCap(THEME.text.capM[role]) * 1.06;
};
const medium = widthIn(inter.medium);
const bold = widthIn(inter.bold);
const measure = (t: string, role: TextRole, weight: number) => (weight >= 600 ? bold(t, role) : medium(t, role));

function happyRows(): DebriefRow[] {
  return singleSource.eventSets.map((es) => ({ eventSetId: es.id, title: es.title, technical: es.technical, crm: es.crm, grade: 4, hintUsed: false, reasons: [] }));
}
/** Every set graded with its three longest reasons, hints used, and a redo with three more. */
function worstRows(): DebriefRow[] {
  return singleSource.eventSets.map((es) => {
    const reasons = [...es.checks]
      .sort((a, b) => b.reason.length - a.reason.length)
      .slice(0, 3)
      .map((c) => ({ label: REASON_LABELS[c.category], text: c.reason }));
    return { eventSetId: es.id, title: es.title, technical: es.technical, crm: es.crm, grade: 1, hintUsed: true, reasons, redoGrade: 2, redoHintUsed: true, redoReasons: reasons };
  });
}

describe('debrief layout', () => {
  it('guided flight: the GUIDED FLIGHT label fits between the title and "Page n of N" (T24)', () => {
    const labelLeft = guidedLabelX(bold(DEBRIEF_TITLE, 'title'));
    const labelRight = labelLeft + bold(GUIDED_LABEL, 'body');
    const pageLeft = pageLabelRight() - bold('Page 9 of 9', 'body');
    expect(labelLeft - (debriefGeo().header.titleX + bold(DEBRIEF_TITLE, 'title'))).toBeGreaterThanOrEqual(0.012);
    expect(pageLeft - labelRight).toBeGreaterThanOrEqual(0.012);
  });

  it('a clean run (four grade-4 rows) fits one page at THEME body', () => {
    const lay = layoutDebrief(happyRows(), measure);
    expect(lay.pages).toHaveLength(1);
    expect(lay.pages[0].map((r) => r.rowIndex)).toEqual([0, 1, 2, 3]);
  });

  it('worst-case content: every row fits a page on its own and no line is wider than the text column', () => {
    const g = debriefGeo();
    const lay = layoutDebrief(worstRows(), measure);
    for (const r of lay.rows) {
      expect(r.h, `row ${r.rowIndex}`).toBeLessThanOrEqual(g.area.h);
      for (const l of r.lines) expect(measure(l.text, 'body', l.weight), l.text).toBeLessThanOrEqual(g.text.w + 1e-9);
    }
    // all rows appear exactly once, in order
    expect(lay.pages.flat().map((p) => p.rowIndex)).toEqual([0, 1, 2, 3]);
    for (const page of lay.pages) for (const p of page) expect(p.top + p.h).toBeLessThanOrEqual(g.area.h + 1e-9);
  });

  it('header and rows keep ASCII text, and the grade column fits a row', () => {
    const lay = layoutDebrief(worstRows(), measure);
    for (const r of lay.rows) for (const l of r.lines) expect(l.text).toMatch(/^[\x20-\x7e]*$/);
    expect(debriefGeo().redo.h + 2 * debriefGeo().rowInset).toBeLessThanOrEqual(Math.min(...lay.rows.map((r) => r.h)));
    expect(BUTTON_H).toBeGreaterThanOrEqual(THEME.control.minHitM);
  });
});


// ---- T29 step 2: TIMELINE pad on the debrief rows and the timeline view ----------------------------------------------

const MIN_PAD = 0.035;
const LABEL_SIDE = 0.006;
const boldBody = (t: string) => bold(t, 'body');
const rowsets: Array<[string, () => DebriefRow[]]> = [['happyRows', happyRows], ['worstRows', worstRows]];

describe('debrief TIMELINE and REDO pads', () => {
  it('each is >= 35 mm both ways, >= 12 mm apart and inside its row, on every page', () => {
    const g = debriefGeo();
    for (const [name, make] of rowsets) {
      const rows = make();
      const lay = layoutDebrief(rows, measure);
      lay.pages.forEach((page, pi) => {
        const pads = debriefPads(rows, lay, pi);
        for (const placed of page) {
          const id = rows[placed.rowIndex].eventSetId;
          const tl = pads.find((p) => p.id === `timeline:${id}`);
          const rd = pads.find((p) => p.id === `redo:${id}`);
          expect(tl, `${name} page ${pi} timeline:${id}`).toBeDefined();
          expect(rd, `${name} page ${pi} redo:${id}`).toBeDefined();
          for (const p of [tl!, rd!]) {
            expect(p.rect.w, `${name} ${p.id} w`).toBeGreaterThanOrEqual(MIN_PAD);
            expect(p.rect.h, `${name} ${p.id} h`).toBeGreaterThanOrEqual(MIN_PAD);
            const top = g.area.top - placed.top;
            expect(p.rect.cy + p.rect.h / 2, `${name} ${p.id} below row top`).toBeLessThanOrEqual(top + 1e-9);
            expect(p.rect.cy - p.rect.h / 2, `${name} ${p.id} above row bottom`).toBeGreaterThanOrEqual(top - placed.h - 1e-9);
            expect(p.rect.cx - p.rect.w / 2, `${name} ${p.id} inside left`).toBeGreaterThanOrEqual(-g.W / 2 + SCREEN_MARGIN - 1e-9);
            expect(p.rect.cx + p.rect.w / 2, `${name} ${p.id} inside right`).toBeLessThanOrEqual(g.W / 2 - SCREEN_MARGIN + 1e-9);
          }
          expect(gap(tl!.rect, rd!.rect), `${name} ${id} timeline/redo gap`).toBeGreaterThanOrEqual(0.012 - 1e-9);
        }
      });
    }
  });

  it('timelineRect and redoRect keep the debriefGeo fields; the grade column and text column do not overlap the pads', () => {
    const g = debriefGeo();
    const tl = timelineRect(0);
    const rd = redoRect(0);
    expect(rd).toMatchObject({ cx: g.redo.cx, w: g.redo.w, h: g.redo.h });
    expect(tl).toMatchObject({ cx: g.timeline.cx, w: g.timeline.w, h: g.timeline.h });
    expect(tl.cy).toBeCloseTo(rd.cy, 9);
    expect(g.grade.cx + g.grade.w / 2 + SCREEN_GAP, 'grade column / TIMELINE').toBeLessThanOrEqual(tl.cx - tl.w / 2 + 1e-9);
    expect(g.text.right + SCREEN_GAP, 'text / grade column').toBeLessThanOrEqual(g.grade.cx - g.grade.w / 2 + 1e-9);
  });

  it('the TIMELINE and REDO labels fit their pads at body size, bold, with 6 mm each side', () => {
    const g = debriefGeo();
    expect(boldBody('TIMELINE') + 2 * LABEL_SIDE, 'TIMELINE').toBeLessThanOrEqual(g.timeline.w + 1e-9);
    expect(boldBody('REDO') + 2 * LABEL_SIDE, 'REDO').toBeLessThanOrEqual(g.redo.w + 1e-9);
  });

  it('every debrief pad, including TIMELINE, stays inside the reach and yaw limits on every page', () => {
    for (const [, make] of rowsets) {
      const rows = make();
      const lay = layoutDebrief(rows, measure);
      lay.pages.forEach((_, pi) => {
        for (const p of debriefPads(rows, lay, pi)) checkPad(p.id, SCREENS.large, p.rect);
      });
    }
  });

  it('a clean run still fits one page, and the worst case still has one row per page', () => {
    expect(layoutDebrief(happyRows(), measure).pages).toHaveLength(1);
    expect(layoutDebrief(worstRows(), measure).pages.every((p) => p.length === 1)).toBe(true);
  });
});

describe('timeline view geometry', () => {
  it('BACK sits at FINISH, PREV and NEXT at the debrief PREV and NEXT', () => {
    const g = debriefGeo();
    const t = timelineGeo();
    expect(t.back).toEqual(g.finish);
    expect(t.prev).toEqual(g.prev);
    expect(t.next).toEqual(g.next);
    expect(t.timeX).toBeCloseTo(-t.W / 2 + SCREEN_MARGIN + 0.006, 9);
    expect(t.textX).toBeCloseTo(t.timeX + 0.055, 9);
    expect(t.area.top).toBeCloseTo(g.area.top, 9);
    expect(t.area.h).toBeCloseTo(g.area.h, 9);
  });

  it('BACK, PREV and NEXT are >= 35 mm, >= 12 mm apart and inside the reach and yaw limits', () => {
    const lay = layoutTimeline(Array.from({ length: 80 }, (_, i) => ({ tSec: i, who: 'you' as const, text: `line ${i}` })), () => 0.05);
    expect(lay.pages.length).toBeGreaterThan(2);
    for (let page = 0; page < lay.pages.length; page++) {
      const pads = timelinePads(lay, page);
      for (const p of pads) checkPad(p.id, SCREENS.large, p.rect);
      for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) expect(gap(pads[i].rect, pads[j].rect)).toBeGreaterThanOrEqual(0.012 - 1e-9);
      const ids = pads.map((p) => p.id);
      expect(ids.includes('back')).toBe(true);
      expect(ids.includes('prev')).toBe(page > 0);
      expect(ids.includes('next')).toBe(page < lay.pages.length - 1);
    }
  });

  it('every header, with " (REDO)", fits left of PREV at body size, bold (title size is 371 mm for Event Set 1: too wide)', () => {
    const t = timelineGeo();
    for (const [i, es] of singleSource.eventSets.entries()) {
      const w = bold(`${timelineTitle(i + 1, es.title)} (REDO)`, 'body');
      expect(w, es.title).toBeLessThanOrEqual(t.titleMaxW + 1e-9);
    }
  });
});

describe('layoutTimeline', () => {
  // 10 mm per character regardless of weight: the text column holds floor(textW / 0.01) characters
  const m = (s: string) => s.length * 0.01;
  const perLine = Math.floor(timelineGeo().textW / 0.01);
  const BODY = lineHeightM('body');
  const pilot = (tSec: number, text: string): TimelineEntry => ({ tSec, who: 'you', text });
  const event = (tSec: number, text: string): TimelineEntry => ({ tSec, who: 'event', text });
  const flat = (l: ReturnType<typeof layoutTimeline>) => l.pages.flat();

  it('prefixes pilot lines with "YOU  " and keeps the clock only on the first line of a wrapped entry', () => {
    const long = `${'word '.repeat(30)}end`;
    const lay = layoutTimeline([event(0, 'ATC: hold short.'), pilot(74, long)], m);
    const lines = flat(lay);
    expect(lines[0]).toEqual({ clock: '0:00', text: 'ATC: hold short.', you: false });
    const mine = lines.filter((l) => l.you);
    expect(mine.length).toBeGreaterThan(1);
    expect(mine[0].clock).toBe('1:14');
    expect(mine[0].text.startsWith('YOU  ')).toBe(true);
    for (const l of mine.slice(1)) {
      expect(l.clock).toBe('');
      expect(l.text.startsWith('YOU')).toBe(false);
    }
    for (const l of lines) expect(m(l.text), l.text).toBeLessThanOrEqual(timelineGeo().textW + 1e-9);
    expect(mine.map((l) => l.text.replace(/^YOU {2}/, '')).join(' ')).toBe(long);
  });

  it('wrapped event lines have an empty clock after the first line', () => {
    const lay = layoutTimeline([event(5, 'x'.repeat(perLine + 10).replace(/(.{6})/g, '$1 '))], m);
    const ev = flat(lay).filter((l) => !l.you && l.text !== TIMELINE_EMPTY && l.text !== TIMELINE_FOOT);
    expect(ev.length).toBeGreaterThan(1);
    expect(ev[0].clock).toBe('0:05');
    expect(ev.slice(1).every((l) => l.clock === '')).toBe(true);
  });

  it('pages when the lines do not fit and puts every line exactly once on some page', () => {
    const per = Math.floor(timelineGeo().area.h / BODY + 1e-9);
    const entries = Array.from({ length: per * 2 + 3 }, (_, i) => pilot(i, `action ${i}`));
    const lay = layoutTimeline(entries, m);
    expect(lay.pages.length).toBeGreaterThanOrEqual(3);
    for (const p of lay.pages.slice(0, -1)) expect(p).toHaveLength(per);
    expect(flat(lay).filter((l) => l.you)).toHaveLength(entries.length);
  });

  it('reserves height on page 0 only', () => {
    const per = Math.floor(timelineGeo().area.h / BODY + 1e-9);
    const entries = Array.from({ length: per * 2 }, (_, i) => pilot(i, `action ${i}`));
    const plain = layoutTimeline(entries, m);
    const reserve = 5 * BODY;
    const withReserve = layoutTimeline(entries, m, reserve);
    expect(withReserve.pages[0].length).toBe(Math.floor((timelineGeo().area.h - reserve) / BODY + 1e-9));
    expect(withReserve.pages[0].length).toBeLessThan(plain.pages[0].length);
    expect(withReserve.pages[1].length).toBe(plain.pages[1].length);
    expect(flat(withReserve).map((l) => l.text)).toEqual(flat(plain).map((l) => l.text));
  });

  it('a log with no pilot line ends with "No pilot actions recorded." before the foot', () => {
    const lay = layoutTimeline([event(0, 'ATC: hold short.'), event(30, 'ALERT: GEN 1 FAULT')], m);
    const texts = flat(lay).map((l) => l.text);
    expect(texts.slice(-2)).toEqual([TIMELINE_EMPTY, TIMELINE_FOOT]);
    expect(TIMELINE_EMPTY).toBe('No pilot actions recorded.');
    const none = flat(layoutTimeline([], m)).map((l) => l.text);
    expect(none).toEqual([TIMELINE_EMPTY, TIMELINE_FOOT]);
    // with a pilot line the message is absent
    expect(flat(layoutTimeline([pilot(1, 'HDG 090')], m)).some((l) => l.text === TIMELINE_EMPTY)).toBe(false);
  });

  it('the foot line is the last line of the last page', () => {
    const per = Math.floor(timelineGeo().area.h / BODY + 1e-9);
    for (const n of [1, per - 1, per, per * 2]) {
      const lay = layoutTimeline(Array.from({ length: n }, (_, i) => pilot(i, `action ${i}`)), m);
      const last = lay.pages[lay.pages.length - 1];
      expect(last[last.length - 1], `${n} entries`).toEqual({ clock: '', text: TIMELINE_FOOT, you: false });
      expect(TIMELINE_FOOT).toBe('Times are scenario time from the start of this Event Set.');
      expect(flat(lay).filter((l) => l.text === TIMELINE_FOOT)).toHaveLength(1);
    }
  });

  it('every produced line is printable ASCII', () => {
    const lay = layoutTimeline([event(0, 'ATC: hold short.'), pilot(3, 'HDG 090')], m);
    for (const l of flat(lay)) {
      expect(l.text).toMatch(/^[\x20-\x7e]*$/);
      expect(l.clock).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

// ---- a real Single Source timeline (a trimmed copy of the drivers in tests/engine/timeline.test.ts) ----

function driveEventSet3() {
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
  tick(2);
  reply('twr-hold', 'hold-readback');
  ctl('baro.set', 1004);
  ctl('ap.hdg', 90);
  ctl('ap.alt', 4000);
  ctl('lights.landing', true);
  ctl('lights.strobe', true);
  tick(2);
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) item('beforeTakeoff', id);
  inSet('es2-takeoff-climb');
  tick(2);
  reply('twr-takeoff', 'to-readback');
  waitFor('dep-climb');
  reply('dep-climb', 'dev-left');
  ctl('ap.engage', true);
  ctl('ap.alt', 12000);
  ctl('ap.vertical', 'climb');
  ctl('ap.hdg', 60);
  inSet('es3-gen-failure');
  tick(1);
  reply('dep-handoff', 'ho-readback');
  waitFor('gen1-fail');
  tick(2);
  e.dispatch({ kind: 'alertAck', alertId: 'gen1-fail' });
  tick(1);
  item('genFail', 'gf-identify');
  ctl('elec.gen1', false);
  item('genFail', 'gf-gen1-off');
  ctl('elec.busTie', true);
  item('genFail', 'gf-bustie');
  item('genFail', 'gf-cabin');
  item('genFail', 'gf-review');
  waitFor('cab-lights');
  reply('cab-lights', 'cab-standby');
  waitFor('ctr-query');
  reply('ctr-query', 'ctr-report');
  inSet('es4-decision');
  const def = singleSource.eventSets.find((x) => x.id === 'es3-gen-failure')!;
  return buildTimeline(singleSource, def, e.historyFor('es3-gen-failure'));
}

describe('a real Single Source timeline', () => {
  it('Event Set 3 lays out with no line wider than the text width, with and without a reserve', () => {
    const entries = driveEventSet3();
    expect(entries.some((x) => x.who === 'you')).toBe(true);
    const t = timelineGeo();
    for (const reserve of [0, 0.1]) {
      const lay = layoutTimeline(entries, (str, weight) => measure(str, 'body', weight), reserve);
      for (const line of lay.pages.flat()) {
        expect(measure(line.text, 'body', line.you ? 700 : 500), line.text).toBeLessThanOrEqual(t.textW + 1e-9);
        expect(line.text).toMatch(/^[\x20-\x7e]*$/);
        expect(measure(line.clock, 'body', line.you ? 700 : 500)).toBeLessThanOrEqual(t.textX - t.timeX + 1e-9);
      }
      const last = lay.pages[lay.pages.length - 1];
      expect(last[last.length - 1].text).toBe(TIMELINE_FOOT);
    }
  });
});

// ---- T30 step 2: electrical diagram strip on the timeline view ----------------------------------------------------------

const eg = (switchOn: boolean, failed = false) => ({ switchOn, failed });
const mkElec = (gen1: ReturnType<typeof eg>, gen2: ReturnType<typeof eg>, busTie: boolean, backupGenInop = false): Elec => ({ gen1, gen2, backupGenInop, busTie });
const mkMoment = (label: ElecMoment['label'], tSec: number, elec: Elec): ElecMoment => ({ label, tSec, elec });

/** Every electrical state the cockpit can reach: two switches, two failed flags, bus tie, backup inoperative. */
function allElecStates(): Elec[] {
  const out: Elec[] = [];
  for (const [a, af] of [[true, false], [false, false], [true, true], [false, true]] as const)
    for (const [b, bf] of [[true, false], [false, false], [true, true], [false, true]] as const)
      for (const tie of [false, true]) for (const inop of [false, true]) out.push(mkElec(eg(a, af), eg(b, bf), tie, inop));
  return out;
}
/** The five sentences of elecCaption, one state each. */
const captionStates = (): Elec[] => [
  mkElec(eg(true), eg(true), false),
  mkElec(eg(false), eg(true), true, true),
  mkElec(eg(true, true), eg(true), true, false),
  mkElec(eg(false), eg(true), false),
  mkElec(eg(false), eg(true, true), true),
];

describe('elecLabels', () => {
  it('a failed generator reads FAILED even with its switch on', () => {
    const l = elecLabels(mkMoment('AT FAULT', 21.4, mkElec(eg(true, true), eg(true), false)));
    expect(l.gen1).toBe('GEN 1 FAILED');
    expect(l.gen2).toBe('GEN 2 ON');
    expect(elecLabels(mkMoment('END', 5, mkElec(eg(false, true), eg(true, true), false))).gen1).toBe('GEN 1 FAILED');
    expect(elecLabels(mkMoment('END', 5, mkElec(eg(false, true), eg(true, true), false))).gen2).toBe('GEN 2 FAILED');
  });

  it('Event Set 3 END reads GEN 1 OFF, GEN 2 ON, BUS 1 POWERED, BUS 2 POWERED, TIE ON, BACKUP GEN INOP', () => {
    const e = mkElec(eg(false, true), eg(true), true, true);
    // The END state as the plan words it (GEN 1 switch off, not marked failed). The real run keeps the failed flag: see the page 0 block below.
    const l = elecLabels(mkMoment('END', 112, { ...e, gen1: eg(false, false) }));
    expect(l).toMatchObject({ gen1: 'GEN 1 OFF', gen2: 'GEN 2 ON', bus1: 'BUS 1 POWERED', bus2: 'BUS 2 POWERED', tie: 'TIE ON', backup: 'BACKUP GEN INOP', caption: 'GEN 2 powers both buses through the bus tie. No backup generator remains.' });
  });

  it('unpowered buses, tie off and a working backup read in words', () => {
    const l = elecLabels(mkMoment('AT FAULT', 3, mkElec(eg(true, true), eg(true), false, false)));
    expect(l).toMatchObject({ bus1: 'BUS 1 NO POWER', bus2: 'BUS 2 POWERED', tie: 'TIE OFF', backup: 'BACKUP GEN', caption: elecCaption(mkElec(eg(true, true), eg(true), false)) });
  });

  it('AT FAULT and END heads carry the clock, START does not', () => {
    const e = mkElec(eg(true), eg(true), false);
    expect(elecLabels(mkMoment('START', 0, e)).head).toBe('START');
    expect(elecLabels(mkMoment('AT FAULT', 21.4, e)).head).toBe('AT FAULT 0:21');
    expect(elecLabels(mkMoment('END', 125, e)).head).toBe('END 2:05');
  });
});

describe('elec strip layout', () => {
  const g = timelineGeo();
  const stripW = g.textX + g.textW - g.timeX;
  const bold = (s: string) => measure(s, 'body', 700);
  const set = (e: Elec, n: number): ElecMoment[] =>
    n === 2 ? [mkMoment('START', 0, e), mkMoment('END', 99, e)] : [mkMoment('START', 0, e), mkMoment('AT FAULT', 21, e), mkMoment('END', 99, e)];
  const lay = (moments: ElecMoment[]) => layoutElecStrip(moments, (t, weight) => measure(t, 'body', weight));
  const boxesOf = (l: ReturnType<typeof layoutElecStrip>): ElecBox[] => l.columns.flatMap((c) => c.boxes);

  it('moments sit in equal columns across the timeline text area, side by side', () => {
    for (const n of [2, 3]) {
      const l = lay(set(captionStates()[0], n));
      expect(l.columns).toHaveLength(n);
      const w0 = l.columns[0].w;
      for (const c of l.columns) expect(c.w).toBeCloseTo(w0, 9);
      for (let i = 1; i < n; i++) expect(l.columns[i].cx).toBeGreaterThan(l.columns[i - 1].cx + w0 - 1e-9);
      expect(l.columns[0].cx - w0 / 2).toBeGreaterThanOrEqual(g.timeX - 1e-9);
      expect(l.columns[n - 1].cx + w0 / 2).toBeLessThanOrEqual(g.textX + g.textW + 1e-9);
      expect(w0 * n).toBeLessThanOrEqual(stripW + 1e-9);
    }
  });

  it('with three moments every label fits its box and every state fits the strip', () => {
    for (const e of allElecStates()) {
      const l = lay(set(e, 3));
      for (const b of boxesOf(l)) {
        expect(b.lines.length, b.lines.join('|')).toBeGreaterThan(0);
        for (const line of b.lines) expect(bold(line), `${b.key}: ${line}`).toBeLessThanOrEqual(b.w - 2 * ELEC_BOX_PAD_X + 1e-9);
        expect(b.lines.length * lineHeightM('body'), b.key).toBeLessThanOrEqual(b.h + 1e-9);
        expect(b.top + b.h, b.key).toBeLessThanOrEqual(ELEC_STRIP_H + 1e-9);
        expect(b.cx - b.w / 2).toBeGreaterThanOrEqual(g.timeX - 1e-9);
        expect(b.cx + b.w / 2).toBeLessThanOrEqual(g.textX + g.textW + 1e-9);
      }
      expect(l.height).toBeLessThanOrEqual(ELEC_STRIP_H + 1e-9);
    }
  });

  it('every caption of elecCaption wraps into at most four lines inside its column, three columns and two', () => {
    for (const n of [2, 3]) {
      for (const e of captionStates()) {
        const l = lay(set(e, n));
        for (const c of l.columns) {
          expect(c.caption.join(' ')).toBe(elecCaption(e));
          expect(c.caption.length, elecCaption(e)).toBeLessThanOrEqual(4);
          for (const line of c.caption) expect(measure(line, 'body', 500), line).toBeLessThanOrEqual(c.w + 1e-9);
        }
      }
    }
  });

  it('the whole strip, caption and foot line included, fits ELEC_STRIP_H, and ELEC_STRIP_H leaves the log room on page 0', () => {
    for (const n of [2, 3]) {
      for (const e of [...captionStates(), ...allElecStates()]) {
        const l = lay(set(e, n));
        expect(l.height, `${n} moments`).toBeLessThanOrEqual(ELEC_STRIP_H + 1e-9);
        expect(l.foot.text).toBe(ELEC_FOOT);
        expect(measure(l.foot.text, 'body', 500)).toBeLessThanOrEqual(stripW + 1e-9);
        expect(l.foot.top + lineHeightM('body')).toBeLessThanOrEqual(ELEC_STRIP_H + 1e-9);
        for (const c of l.columns) expect(c.captionTop + c.caption.length * lineHeightM('body')).toBeLessThanOrEqual(l.foot.top + 1e-9);
      }
    }
    expect(ELEC_STRIP_H).toBeLessThanOrEqual(0.21);
    expect(g.area.h - ELEC_STRIP_H).toBeGreaterThanOrEqual(8 * lineHeightM('body'));
  });

  it('two moments make the columns wider than three', () => {
    const e = captionStates()[1];
    expect(lay(set(e, 2)).columns[0].w).toBeGreaterThan(lay(set(e, 3)).columns[0].w);
  });

  it('every diagram string is printable ASCII', () => {
    const ascii = /^[\x20-\x7e]*$/;
    expect(ELEC_FOOT).toMatch(ascii);
    for (const e of allElecStates()) {
      for (const label of ['START', 'AT FAULT', 'END'] as const) {
        const l = elecLabels(mkMoment(label, 1234.5, e));
        for (const v of Object.values(l)) expect(v).toMatch(ascii);
      }
    }
  });
});

/** A ZoneCanvas stand-in that records what is drawn. */
function recorder() {
  const calls: Array<{ k: 'box' | 'line' | 'text'; a: unknown[] }> = [];
  const zc = {
    W: 0.72,
    H: 0.44,
    measure: (s: string, role: TextRole, weight = 600) => measure(s, role, weight),
    box: (...a: unknown[]) => calls.push({ k: 'box', a }),
    line: (...a: unknown[]) => calls.push({ k: 'line', a }),
    text: (...a: unknown[]) => calls.push({ k: 'text', a }),
  } as unknown as ZoneCanvas;
  return { zc, calls };
}

describe('drawElecStrip', () => {
  const lines = (calls: ReturnType<typeof recorder>['calls']) =>
    calls.filter((c) => c.k === 'line').map((c) => ({ x1: c.a[0] as number, y1: c.a[1] as number, x2: c.a[2] as number, y2: c.a[3] as number, color: c.a[4] as string, dashed: (c.a[6] as boolean | undefined) === true }));
  const texts = (calls: ReturnType<typeof recorder>['calls']) => calls.filter((c) => c.k === 'text').map((c) => ({ s: c.a[0] as string, x: c.a[1] as number, y: c.a[2] as number, role: c.a[3] as TextRole }));
  const top = timelineGeo().area.top;

  it('draws every label, the captions and the foot line, all at body size, inside the strip', () => {
    const ms = [mkMoment('START', 0, mkElec(eg(true), eg(true), false)), mkMoment('AT FAULT', 21, mkElec(eg(true, true), eg(true), false)), mkMoment('END', 99, mkElec(eg(false), eg(true), true, true))];
    const { zc, calls } = recorder();
    drawElecStrip(zc, top, ms);
    const t = texts(calls);
    for (const m of ms) {
      const l = elecLabels(m);
      for (const s of [l.head, l.gen1, l.gen2, l.bus1, l.bus2, l.tie, l.backup]) expect(t.some((x) => x.s === s || s.startsWith(x.s)), s).toBe(true);
    }
    expect(t.some((x) => x.s === ELEC_FOOT)).toBe(true);
    for (const x of t) {
      expect(x.role).toBe('body');
      expect(x.s).toMatch(/^[\x20-\x7e]+$/);
      expect(x.y).toBeLessThanOrEqual(top + 1e-9);
      expect(x.y).toBeGreaterThanOrEqual(top - ELEC_STRIP_H - 1e-9);
    }
    const foot = t.find((x) => x.s === ELEC_FOOT)!;
    for (const x of t) if (x !== foot) expect(x.y).toBeGreaterThan(foot.y);
  });

  it('a generator that is not online draws a dashed dim line to its bus, an online one a solid normal line', () => {
    const { zc, calls } = recorder();
    drawElecStrip(zc, top, [mkMoment('AT FAULT', 21, mkElec(eg(true, true), eg(true), false)), mkMoment('END', 99, mkElec(eg(false), eg(true), true, true))]);
    const ls = lines(calls);
    expect(ls.some((l) => l.dashed && l.color === THEME.color.textDim)).toBe(true);
    expect(ls.some((l) => !l.dashed && l.color === THEME.display.normal)).toBe(true);
  });

  it('the tie is solid when on and dashed when off; an inoperative backup has a dashed caution outline', () => {
    const on = recorder();
    drawElecStrip(on.zc, top, [mkMoment('START', 0, mkElec(eg(true), eg(true), true, true)), mkMoment('END', 9, mkElec(eg(true), eg(true), true, true))]);
    const off = recorder();
    drawElecStrip(off.zc, top, [mkMoment('START', 0, mkElec(eg(true), eg(true), false, false)), mkMoment('END', 9, mkElec(eg(true), eg(true), false, false))]);
    // Both generators are online in all four, so a dashed line can only be the tie (off) or the backup outline (inoperative).
    expect(lines(on.calls).filter((l) => l.dashed && l.color === THEME.color.textDim)).toHaveLength(0);
    expect(lines(off.calls).filter((l) => l.dashed && l.color === THEME.color.textDim).length).toBeGreaterThan(0);
    expect(lines(on.calls).filter((l) => l.dashed && l.color === THEME.alert.caution).length).toBeGreaterThan(0);
    expect(lines(off.calls).filter((l) => l.dashed && l.color === THEME.alert.caution)).toHaveLength(0);
  });

  it('a powered bus is a filled box and an unpowered bus an outline', () => {
    const { zc, calls } = recorder();
    drawElecStrip(zc, top, [mkMoment('START', 0, mkElec(eg(true, true), eg(true), false)), mkMoment('END', 9, mkElec(eg(true, true), eg(true), false))]);
    const boxes = calls.filter((c) => c.k === 'box');
    const filled = boxes.filter((c) => c.a[4] === THEME.display.normal);
    expect(filled).toHaveLength(2); // BUS 2 once per column
    expect(boxes.some((c) => c.a[4] === null && c.a[5] !== undefined)).toBe(true); // BUS 1 outline
  });

  it('draws nothing when there are no moments', () => {
    const { zc, calls } = recorder();
    drawElecStrip(zc, top, []);
    expect(calls).toHaveLength(0);
  });
});

/** The real Single Source Event Set 3, driven like tests/engine/power.test.ts, returning what the host gets. */
function driveEs3Review() {
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
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
  };
  const until = (what: string, pred: () => boolean) => {
    let t = 0;
    while (!pred()) {
      if (t > 240 || e.status.run !== 'running') throw new Error(`timed out waiting for ${what}`);
      e.tick(0.1);
      t += 0.1;
    }
  };
  tick(2);
  reply('twr-hold', 'hold-readback');
  ctl('baro.set', 1004);
  ctl('ap.hdg', 90);
  ctl('ap.alt', 4000);
  ctl('lights.landing', true);
  ctl('lights.strobe', true);
  tick(2);
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) item('beforeTakeoff', id);
  until('es2', () => e.status.eventSetId === 'es2-takeoff-climb');
  tick(2);
  reply('twr-takeoff', 'to-readback');
  until('dep-climb', () => seen.has('dep-climb'));
  reply('dep-climb', 'dev-left');
  ctl('ap.engage', true);
  ctl('ap.alt', 12000);
  ctl('ap.vertical', 'climb');
  ctl('ap.hdg', 60);
  until('es3', () => e.status.eventSetId === 'es3-gen-failure');
  tick(1);
  reply('dep-handoff', 'ho-readback');
  until('gen1-fail', () => seen.has('gen1-fail'));
  tick(2);
  e.dispatch({ kind: 'alertAck', alertId: 'gen1-fail' });
  tick(1);
  item('genFail', 'gf-identify');
  ctl('elec.gen1', false);
  item('genFail', 'gf-gen1-off');
  ctl('elec.busTie', true);
  item('genFail', 'gf-bustie');
  item('genFail', 'gf-cabin');
  item('genFail', 'gf-review');
  until('cab-lights', () => seen.has('cab-lights'));
  reply('cab-lights', 'cab-standby');
  until('ctr-query', () => seen.has('ctr-query'));
  reply('ctr-query', 'ctr-report');
  until('es4', () => e.status.eventSetId === 'es4-decision');
  const def = singleSource.eventSets.find((x) => x.id === 'es3-gen-failure')!;
  const history = e.historyFor('es3-gen-failure');
  return { entries: buildTimeline(singleSource, def, history), elec: elecMoments(history) };
}

describe('timeline page 0 with an electrical diagram', () => {
  const BODY = lineHeightM('body');
  const area = timelineGeo().area;
  const review = driveEs3Review();
  const m = (t: string, weight: number) => measure(t, 'body', weight);

  it('the Event Set 3 review has START, AT FAULT and END; GEN 1 is switched off but stays failed, so it still reads FAILED', () => {
    expect(review.elec?.map((x) => x.label)).toEqual(['START', 'AT FAULT', 'END']);
    const end = elecLabels(review.elec![2]);
    expect([end.gen1, end.gen2, end.tie, end.bus1, end.bus2]).toEqual(['GEN 1 FAILED', 'GEN 2 ON', 'TIE ON', 'BUS 1 POWERED', 'BUS 2 POWERED']);
    expect(review.elec![2].elec.gen1).toEqual({ switchOn: false, failed: true });
  });

  it('with a diagram page 0 starts its log below the strip; without one it uses the full height', () => {
    const plain = layoutTimeline(review.entries, m);
    const withStrip = layoutTimeline(review.entries, m, ELEC_STRIP_H);
    expect(plain.reserveH).toBe(0);
    expect(withStrip.reserveH).toBe(ELEC_STRIP_H);
    const total = plain.pages.flat().length;
    expect(withStrip.pages.flat().length).toBe(total); // same lines, just paged differently
    const capWith = Math.floor((area.h - ELEC_STRIP_H) / BODY + 1e-9);
    expect(withStrip.pages[0].length).toBe(Math.min(total, capWith));
    expect(plain.pages[0].length).toBe(Math.min(total, Math.floor(area.h / BODY + 1e-9)));
    // the log on page 0 lies wholly below the strip, inside the area
    expect(area.top - ELEC_STRIP_H - withStrip.pages[0].length * BODY).toBeGreaterThanOrEqual(area.bottom - 1e-9);
    // the foot line is still the last line of the last page
    const last = withStrip.pages[withStrip.pages.length - 1];
    expect(last[last.length - 1].text).toBe(TIMELINE_FOOT);
    expect(total).toBeGreaterThan(capWith); // the reserve really costs lines on this real review
  });
});

// ---- T31: first officer caption on the windscreen strip ----

it('the longest first officer line fits the existing strip in two body lines', async () => {
 const { wrapText } = await import('../../src/xr/panels/textLayout');
 const text = 'Bus tie is on. GEN 2 is powering both buses.';
 const lines = wrapText(text, SCREENS.coach.size[0] - 2 * SCREEN_MARGIN, t => measure(t, 'body', 500));
 expect(lines.length).toBeLessThanOrEqual(2); expect(lines.join(' ')).toBe(text);
});

it('strip prioritizes guide, shows crew only in running/redo, and unchanged captions never redraw', async () => {
 const { Object3D } = await import('@iwsdk/core');
 const canvases: Array<{ panel: { mesh: InstanceType<typeof Object3D>; markDirty: ReturnType<typeof vi.fn>; tick: ReturnType<typeof vi.fn>; setDraw: (fn: () => void) => void }; text: ReturnType<typeof vi.fn>; draw?: () => void }> = [];
 vi.doMock('../../src/xr/panels/draw', () => ({ ZoneCanvas: class {
   panel = { mesh: new Object3D(), markDirty: vi.fn(), tick: vi.fn(), setDraw: (fn: () => void) => { this.draw = fn; } };
   draw?: () => void; text = vi.fn(); W = 1; H = 1;
   constructor() { canvases.push(this); }
   measurer() { return (text: string) => text.length / 1000; }
   clear() {} box() {} fill() {} rect() {} line() {}
 } }));
 vi.doMock('../../src/xr/panels/panelPad', () => ({ createPanelPad: () => ({ rect() {}, hide() {}, press: () => 0, hover: () => 0, front: () => undefined }) }));
 const { createScreens } = await import('../../src/app/screens/host');
 let state = 'running'; let change!: (s: string) => void;
 const app = { get state() { return state; }, onChange: (fn: typeof change) => { change = fn; }, guided: false, debrief: () => [], flights: TWO_FLIGHTS, flight: FLIGHT_A };
 const world = { createTransformEntity: (object3D: unknown) => ({ object3D }) };
 const host = createScreens(world as never, app as never, singleSource, { get: () => 0.1, step() {} });
 const strip = canvases[2];
 host.setCrewCaption('Crew line'); expect(strip.panel.mesh.visible).toBe(true);
 expect(host.stripContent()).toBeNull();
 strip.draw!(); expect(host.stripContent()).toEqual({ head: 'FIRST OFFICER', body: 'Crew line' });
 expect(strip.text.mock.calls.map(c => c[0])).toContain('FIRST OFFICER');
 strip.panel.markDirty.mockClear(); host.setCrewCaption('Crew line'); expect(strip.panel.markDirty).not.toHaveBeenCalled();
 host.setCoach({ head: 'GUIDE', body: 'Guide line' }); strip.text.mockClear(); strip.draw!();
 expect(host.stripContent()).toEqual({ head: 'GUIDE', body: 'Guide line' });
 expect(strip.text.mock.calls.map(c => c[0])).toContain('GUIDE'); expect(strip.text.mock.calls.map(c => c[0])).not.toContain('FIRST OFFICER');
 host.setCoach(null);
 for (const flow of ['paused', 'briefing', 'finished', 'modeSelect']) { state = flow; change(flow); expect(strip.panel.mesh.visible).toBe(false); }
 state = 'redo'; change(state); expect(strip.panel.mesh.visible).toBe(true);
 host.setCrewCaption(null); expect(strip.panel.mesh.visible).toBe(false); expect(host.stripContent()).toBeNull();
 vi.doUnmock('../../src/xr/panels/draw'); vi.doUnmock('../../src/xr/panels/panelPad');
});

// ---- T12: the welcome notice (now with the computer-generated voices sentence) still fits above CONTINUE ----
describe('welcome screen fit (T12)', () => {
  it('title, subtitle, notice, hint and the sound-off line end above the CONTINUE button', async () => {
    const { wrapText } = await import('../../src/xr/panels/textLayout');
    const [W, H] = SCREENS.small.size;
    const width = W - 2 * SCREEN_MARGIN;
    const BODY = lineHeightM('body');
    const lines = (text: string, w: number, weight: number) => wrapText(text, w, (t) => measure(t, 'body', weight)).length;
    expect(singleSource.notice).toContain('Voices are computer-generated.');
    let y = H / 2 - SCREEN_MARGIN - lineHeightM('title');
    y -= lines('Cockpit scenario trainer', width, 600) * BODY;
    y -= SCREEN_GAP / 2 + lines(singleSource.notice, width, 500) * BODY;
    y -= SCREEN_GAP / 2 + lines('Poke a button with a fingertip, or point and pinch.', width - 0.16, 500) * BODY;
    const button = SMALL_BUTTONS.continue;
    expect(y).toBeGreaterThanOrEqual(button.cy + button.h / 2);
    y -= SCREEN_GAP / 2 + lines(SOUND_OFF_LINE, width, 700) * BODY; // T49: the extra line while audio is locked (bold)
    expect(y, 'with the sound-off line').toBeGreaterThanOrEqual(button.cy + button.h / 2);
    expect(singleSource.notice).toMatch(/^[\x20-\x7e]*$/);
  });
});

// ---- T40: SEAT FWD / SEAT BACK on the welcome and paused screens ----
describe('seat buttons (T40)', () => {
  const [W, H] = SCREENS.small.size;
  const M = SCREEN_MARGIN;
  const SEAT_LABELS = Array.from({ length: Math.round(SEAT_MAX_M / SEAT_STEP_M) + 1 }, (_, i) => seatLabel(i * SEAT_STEP_M));
  const labelSlot: Rect = { cx: SEAT_LABEL_SLOT.cx, cy: SEAT_LABEL_SLOT.cy, w: SEAT_LABEL_SLOT.w, h: BUTTON_H };
  const rectOf = (left: number, top: number, w: number, h: number): Rect => ({ cx: left + w / 2, cy: top - h / 2, w, h });
  const overlap = (a: Rect, b: Rect) => gap(a, b) < 0;

  it('both seat pads pass the pad checks and sit apart from CONTINUE, RESUME and each other by SCREEN_GAP', () => {
    for (const id of ['seatFwd', 'seatBack'] as const) checkPad(id, SCREENS.small, SMALL_BUTTONS[id]);
    const { seatFwd, seatBack, continue: cont, resume } = SMALL_BUTTONS;
    for (const [a, b, name] of [[seatFwd, seatBack, 'fwd/back'], [seatBack, cont, 'back/continue'], [seatFwd, cont, 'fwd/continue'], [seatBack, resume, 'back/resume'], [seatFwd, resume, 'fwd/resume']] as const)
      expect(gap(a, b), name).toBeGreaterThanOrEqual(SCREEN_GAP - 1e-9);
  });

  it('the value label sits between the two pads, clear of both and of CONTINUE, at every value', () => {
    expect(SMALL_BUTTONS.seatFwd.cx).toBeLessThan(SEAT_LABEL_SLOT.cx);
    expect(SEAT_LABEL_SLOT.cx).toBeLessThan(SMALL_BUTTONS.seatBack.cx);
    for (const other of [SMALL_BUTTONS.seatFwd, SMALL_BUTTONS.seatBack, SMALL_BUTTONS.continue]) expect(gap(labelSlot, other)).toBeGreaterThanOrEqual(SCREEN_GAP - 1e-9);
    for (const t of SEAT_LABELS) expect(measure(t, 'body', 700), t).toBeLessThanOrEqual(SEAT_LABEL_SLOT.w);
    expect(SEAT_LABELS).toHaveLength(11); // +0 to +50 cm (T51)
  });

  it('the pad labels fit their pads at body size, bold, with 6 mm each side', () => {
    expect(measure('SEAT FWD', 'body', 700) + 0.012).toBeLessThanOrEqual(SMALL_BUTTONS.seatFwd.w + 1e-9);
    expect(measure('SEAT BACK', 'body', 700) + 0.012).toBeLessThanOrEqual(SMALL_BUTTONS.seatBack.w + 1e-9);
  });

  it('the welcome screen offers CONTINUE and both seat pads, and the paused screen RESUME and both seat pads', () => {
    expect(welcomeScreen.buttons).toEqual(['continue', 'seatFwd', 'seatBack']);
    expect(pausedScreen.buttons).toEqual(['resume', 'abandon', 'seatFwd', 'seatBack']);
  });

  for (const soundOff of [false, true]) it(`welcome: title, build stamp, text, hint${soundOff ? ', sound-off line' : ''}, seat row and CONTINUE do not overlap, and everything is inside the screen`, async () => {
    const { wrapText } = await import('../../src/xr/panels/textLayout');
    const { formatBuildStamp } = await import('../../src/app/buildInfo');
    const width = W - 2 * M;
    const BODY = lineHeightM('body');
    const TITLE = lineHeightM('title');
    const lines = (text: string, w: number, weight: number) => wrapText(text, w, (t) => measure(t, 'body', weight)).length;
    const rects: Array<[string, Rect]> = [];
    // title row: the welcome title on the left, the build stamp (date and time only, T49; worst case: the longest date and hour) on the right
    const stampText = formatBuildStamp({ time: '2026-11-30T23:59:00Z', commit: 'abcdef0' }, { timeZone: 'UTC', commit: false });
    const stampW = measure(stampText, 'min', 500);
    const titleW = measure(WELCOME_TITLE, 'title', 700);
    expect(titleW + stampW + SCREEN_GAP, `title ${titleW} + stamp ${stampW}`).toBeLessThanOrEqual(width);
    rects.push(['title', rectOf(-W / 2 + M, H / 2 - M, titleW, TITLE)]);
    rects.push(['stamp', rectOf(W / 2 - M - stampW, H / 2 - M - (TITLE - lineHeightM('min')) / 2, stampW, lineHeightM('min'))]);
    let y = H / 2 - M - TITLE;
    y -= lines('Cockpit scenario trainer', width, 600) * BODY;
    const noticeTop = y - SCREEN_GAP / 2;
    y = noticeTop - lines(singleSource.notice, width, 500) * BODY;
    const hintTop = y - SCREEN_GAP / 2;
    y = hintTop - lines('Poke a button with a fingertip, or point and pinch.', width - 0.16, 500) * BODY;
    if (soundOff) y -= SCREEN_GAP / 2 + lines(SOUND_OFF_LINE, width, 700) * BODY;
    rects.push(['text', rectOf(-W / 2 + M, H / 2 - M - TITLE, width, H / 2 - M - TITLE - y)]);
    for (const id of ['continue', 'seatFwd', 'seatBack'] as const) rects.push([id, SMALL_BUTTONS[id]]);
    rects.push(['seat value', labelSlot]);
    for (let i = 0; i < rects.length; i++) {
      const [n, r] = rects[i];
      expect(r.cx - r.w / 2, `${n} left`).toBeGreaterThanOrEqual(-W / 2 - 1e-9);
      expect(r.cx + r.w / 2, `${n} right`).toBeLessThanOrEqual(W / 2 + 1e-9);
      expect(r.cy + r.h / 2, `${n} top`).toBeLessThanOrEqual(H / 2 + 1e-9);
      expect(r.cy - r.h / 2, `${n} bottom`).toBeGreaterThanOrEqual(-H / 2 - 1e-9);
      for (let j = i + 1; j < rects.length; j++) expect(overlap(r, rects[j][1]), `${n} overlaps ${rects[j][0]}`).toBe(false);
    }
    // text ends above the pads with room to spare
    expect(y).toBeGreaterThanOrEqual(SMALL_BUTTONS.seatFwd.cy + SMALL_BUTTONS.seatFwd.h / 2 + SCREEN_GAP / 2);
    expect(PRODUCT_NAME).toMatch(/^[\x20-\x7e]*$/);
    expect(PRODUCT_NAME).toBe('Sim Zero');
    expect(WELCOME_TITLE).toBe('Welcome to Sim Zero');
    expect(SOUND_OFF_LINE).toBe('Sound is off. Pinch any button to turn it on.');
  });

  it('paused: title, text, seat row, RESUME and RESTART do not overlap, and RESTART is far from RESUME (T51)', async () => {
    const { wrapText } = await import('../../src/xr/panels/textLayout');
    const { PAUSED_TEXT } = await import('../../src/app/screens/status');
    const BODY = lineHeightM('body');
    const textLeft = -W / 2 + M;
    const textW = SMALL_BUTTONS.abandon.cx - SMALL_BUTTONS.abandon.w / 2 - SCREEN_GAP - textLeft;
    const n = wrapText(PAUSED_TEXT, textW, (t) => measure(t, 'body', 500)).length;
    const bottom = H / 2 - M - lineHeightM('title') - n * BODY;
    expect(PAUSED_TEXT).toMatch(/^[\x20-\x7e]*$/);
    expect(PAUSED_TEXT).toMatch(/RESUME carries on\. RESTART ends this flight/);
    for (const id of ['resume', 'abandon', 'seatFwd', 'seatBack'] as const) {
      checkPad(id, SCREENS.small, SMALL_BUTTONS[id]);
      // the paragraph is narrower than the screen, so the pad at the top right only has to clear it sideways
      if (id !== 'abandon') expect(bottom, `text above ${id}`).toBeGreaterThanOrEqual(SMALL_BUTTONS[id].cy + SMALL_BUTTONS[id].h / 2 + SCREEN_GAP / 2);
    }
    expect(overlap(SMALL_BUTTONS.resume, labelSlot)).toBe(false);
    expect(overlap(SMALL_BUTTONS.abandon, SMALL_BUTTONS.resume)).toBe(false);
    // a reach for RESUME cannot hit RESTART: at least 10 cm of screen between the two pads
    expect(gap(SMALL_BUTTONS.abandon, SMALL_BUTTONS.resume)).toBeGreaterThanOrEqual(0.1);
    // RESTART's label fits its pad, bold, with 6 mm each side
    expect(measure('RESTART', 'body', 700) + 0.012).toBeLessThanOrEqual(SMALL_BUTTONS.abandon.w + 1e-9);
    // the paragraph stays left of RESTART and its last line is above the seat row
    expect(textLeft + textW).toBeLessThanOrEqual(SMALL_BUTTONS.abandon.cx - SMALL_BUTTONS.abandon.w / 2 - SCREEN_GAP + 1e-9);
    expect(bottom).toBeGreaterThanOrEqual(SMALL_BUTTONS.seatFwd.cy + SMALL_BUTTONS.seatFwd.h / 2 + SCREEN_GAP / 2);
  });
});

// ---- T41: the debrief pads follow the active flight ----
describe('screen host: scenario swap (T41)', () => {
  it('padPoolSize is the largest flight\'s Event Set count, never below 1', () => {
    expect(padPoolSize(TWO_FLIGHTS)).toBe(2);
    expect(padPoolSize([{ build: () => singleSource }, ...TWO_FLIGHTS])).toBe(singleSource.eventSets.length);
    expect(padPoolSize([])).toBe(1);
  });

  async function mkHost(pool?: number) {
    vi.resetModules(); // the host must load fresh, against this call's mocks
    const { Object3D } = await import('@iwsdk/core');
    vi.doMock('../../src/xr/panels/draw', () => ({ ZoneCanvas: class {
      panel = { mesh: new Object3D(), markDirty: vi.fn(), tick: vi.fn(), setDraw: vi.fn() };
      text = vi.fn(); W = 1; H = 1;
      measurer() { return (text: string) => text.length / 1000; }
      measure(text: string) { return text.length / 1000; }
      clear() {} box() {} fill() {} rect() {} line() {}
    } }));
    const created: Array<{ name: string; onPress: () => void; shown: boolean; rect?: number[] }> = [];
    vi.doMock('../../src/xr/panels/panelPad', () => ({ createPanelPad: (_w: unknown, _z: unknown, name: string, onPress: () => void) => {
      const pad = { name, onPress, shown: false, rect: undefined as number[] | undefined };
      created.push(pad);
      return { rect(...r: number[]) { pad.shown = true; pad.rect = r; }, hide() { pad.shown = false; }, press: () => 0, hover: () => 0, front: () => (pad.shown ? { x: 1, y: 2, z: 3 } : undefined) };
    } }));
    const { createScreens } = await import('../../src/app/screens/host');
    let change!: (s: string) => void;
    let active = FLIGHT_A.build(0);
    const row = (id: string) => ({ eventSetId: id, title: id, technical: '', crm: '', grade: 4, hintUsed: false, reasons: [] });
    const app = {
      state: 'modeSelect',
      guided: false,
      flights: TWO_FLIGHTS,
      flight: FLIGHT_A,
      onChange: (fn: typeof change) => { change = fn; },
      debrief: () => active.eventSets.map((e) => row(e.id)),
      review: () => null,
      redo: vi.fn(),
    };
    const world = { createTransformEntity: (object3D: unknown) => ({ object3D }) };
    const host = createScreens(world as never, app as never, active, { get: () => 0.1, step() {} }, pool);
    const toDebrief = (flight: typeof FLIGHT_A) => {
      active = flight.build(0);
      host.setScenario(active);
      app.state = 'debrief';
      change('debrief');
    };
    const press = (name: string) => {
      vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10_000); // past the screen-change press guard
      created.find((p) => p.name === name)!.onPress();
    };
    return { host, app, created, toDebrief, press };
  }
  const unmock = () => { vi.doUnmock('../../src/xr/panels/draw'); vi.doUnmock('../../src/xr/panels/panelPad'); vi.restoreAllMocks(); };

  it('the pool is made once for the largest flight; after a swap ui:redo and ui:timeline use the new flight\'s set ids only', async () => {
    const { host, created, toDebrief, press, app } = await mkHost(padPoolSizeOf());
    const slotPads = () => created.filter((p) => /^screen\.(redo|timeline)\./.test(p.name)).map((p) => p.name);
    expect(slotPads()).toEqual(['screen.redo.0', 'screen.timeline.0', 'screen.redo.1', 'screen.timeline.1']);
    toDebrief(FLIGHT_A);
    expect(host.targetPosition('ui:redo:fxa-es-a')).toEqual([1, 2, 3]);
    expect(host.targetPosition('ui:timeline:fxa-es-b')).toEqual([1, 2, 3]);
    toDebrief(FLIGHT_B);
    expect(host.targetPosition('ui:redo:fxb-es-a')).toEqual([1, 2, 3]);
    expect(host.targetPosition('ui:timeline:fxb-es-b')).toEqual([1, 2, 3]);
    expect(host.targetPosition('ui:redo:fxa-es-a')).toBeUndefined();
    expect(host.targetPosition('ui:timeline:fxa-es-b')).toBeUndefined();
    expect(slotPads()).toHaveLength(4); // no new pads were made for the swap
    press('screen.redo.1');
    expect(app.redo).toHaveBeenLastCalledWith('fxb-es-b');
    unmock();
  });

  it('a swap to a flight with more Event Sets than the pool grows it; one with fewer leaves the rest hidden', async () => {
    const { host, created, toDebrief, app } = await mkHost(2);
    host.setScenario(singleSource);
    const count = () => created.filter((p) => p.name.startsWith('screen.redo.')).length;
    expect(count()).toBe(singleSource.eventSets.length);
    app.state = 'debrief';
    toDebrief(FLIGHT_A);
    expect(host.targetPosition(`ui:redo:${singleSource.eventSets[0].id}`)).toBeUndefined();
    for (const p of created.filter((q) => /^screen\.(redo|timeline)\.[23]$/.test(q.name))) expect(p.shown, p.name).toBe(false);
    unmock();
  });
});
function padPoolSizeOf(): number {
  return padPoolSize(TWO_FLIGHTS);
}

// ---- T41: the flight picker and the mode screen of a flight with no guide ----
describe('flight picker (T41)', () => {
  const [W, H] = SCREENS.small.size;
  const BODY = lineHeightM('body');
  const TITLE = lineHeightM('title');

  for (const n of [1, 2, 3]) {
    it(`${n} flight(s): every card is a pad of at least 35 mm, SCREEN_GAP apart, centred, inside the screen, in reach`, () => {
      const rects = flightCardRects(n);
      expect(rects).toHaveLength(n);
      rects.forEach((r, i) => checkPad(`card ${i}`, SCREENS.small, r));
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) expect(gap(rects[i], rects[j]), `card ${i}/${j}`).toBeGreaterThanOrEqual(SCREEN_GAP - 1e-9);
      expect(rects.reduce((a, r) => a + r.cx, 0)).toBeCloseTo(0, 9);
      // below the title, and clear of the CONTINUE place the judge's finger just left (and of the margin)
      const titleBottom = H / 2 - SCREEN_MARGIN - TITLE;
      for (const r of rects) {
        expect(r.cy + r.h / 2, 'below the title').toBeLessThanOrEqual(titleBottom - SCREEN_GAP + 1e-9);
        expect(gap(r, SMALL_BUTTONS.continue), 'clear of CONTINUE').toBeGreaterThanOrEqual(SCREEN_GAP - 1e-9);
        expect(r.h).toBe(FLIGHT_CARD_H);
      }
    });
  }

  it('widths for 1, 2 and 3 flights, and never more than three cards', () => {
    expect(flightCardRects(1).map((r) => [r.cx, r.w])).toEqual([[0, 0.26]]);
    expect(flightCardRects(2).map((r) => [r.w, +r.cx.toFixed(3)])).toEqual([[0.21, -0.111], [0.21, 0.111]]);
    expect(flightCardRects(3).map((r) => [r.w, +r.cx.toFixed(3)])).toEqual([[0.144, -0.156], [0.144, 0], [0.144, 0.156]]);
    expect(flightCardRects(7)).toHaveLength(MAX_FLIGHT_CARDS);
    expect(flightCardRects(0)).toHaveLength(1);
    // the three SMALL_BUTTONS slots are the three-card layout, so the generic pad checks cover it
    expect(['flight0', 'flight1', 'flight2'].map((id) => SMALL_BUTTONS[id as 'flight0'])).toEqual(flightCardRects(3));
  });

  it('the screen shows one pad per flight (at most three), at the card rects', () => {
    const ctx = (n: number) => ({ scenario: singleSource, flights: [FLIGHT_A, FLIGHT_B, FLIGHT_C, FLIGHT_A].slice(0, n), flight: FLIGHT_A, level: () => 'idle' as const, seatOffset: () => 0.1 });
    expect(flightSelectScreen.buttons).toEqual(['flight0', 'flight1', 'flight2']);
    for (const n of [1, 2, 3, 4]) {
      const pads = flightSelectScreen.pads!(ctx(n));
      expect(pads.map((p) => p.id)).toEqual(['flight0', 'flight1', 'flight2'].slice(0, Math.min(3, n)));
      expect(pads.map((p) => p.rect)).toEqual(flightCardRects(n));
    }
  });

  it('title, blurb (at most three lines) and length fit every card, for every registered and fixture flight, in the narrowest layout', () => {
    const inner = flightCardRects(3)[0].w - 2 * FLIGHT_CARD_PAD;
    const innerH = FLIGHT_CARD_H - 2 * FLIGHT_CARD_PAD;
    for (const f of [...FLIGHTS, FLIGHT_A, FLIGHT_B, FLIGHT_C]) {
      expect(measure(f.title, 'body', 700), `${f.id} title`).toBeLessThanOrEqual(inner);
      expect(measure(flightMinutes(f), 'body', 700), `${f.id} minutes`).toBeLessThanOrEqual(inner);
      const lines = wrapLines(f.blurb, inner);
      expect(lines, `${f.id} blurb ${f.blurb}`).toBeLessThanOrEqual(FLIGHT_BLURB_LINES);
      // title + gap + blurb lines + the length line
      expect(BODY + 0.003 + lines * BODY + BODY, `${f.id} stack`).toBeLessThanOrEqual(innerH + 1e-9);
      for (const t of [f.title, f.blurb, flightMinutes(f), FLIGHT_SELECT_TITLE]) expect(t).toMatch(/^[\x20-\x7e]*$/);
    }
    expect(flightMinutes({ minutes: 10 })).toBe('about 10 min');
  });

  it('the registered flights have titles and blurbs that suit a card (the picker must hold the longest real text)', () => {
    expect(FLIGHTS.length).toBeGreaterThanOrEqual(1);
    for (const f of FLIGHTS) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.blurb.length).toBeGreaterThan(0);
      expect(Number.isInteger(f.minutes) && f.minutes > 0).toBe(true);
    }
  });

  it('the title fits one line', () => {
    expect(measure(FLIGHT_SELECT_TITLE, 'title', 700)).toBeLessThanOrEqual(W - 2 * SCREEN_MARGIN);
  });

  function wrapLines(text: string, w: number): number {
    let n = 1;
    let line = '';
    for (const word of text.split(' ')) {
      const trial = line ? `${line} ${word}` : word;
      if (measure(trial, 'body', 500) <= w) line = trial;
      else {
        n++;
        line = word;
      }
    }
    return n;
  }
});

describe('mode screen without GUIDED FLIGHT (T41)', () => {
  const ctx = (flight: typeof FLIGHT_A) => ({ scenario: singleSource, flights: TWO_FLIGHTS, flight, level: () => 'idle' as const, seatOffset: () => 0.1 });

  it('a flight with guidance offers both modes where they have always been', () => {
    expect(modeSelectScreen.pads!(ctx(FLIGHT_A))).toEqual([{ id: 'guided', rect: SMALL_BUTTONS.guided }, { id: 'auto', rect: SMALL_BUTTONS.auto }]);
    expect(modeHint(FLIGHT_A)).toBe('First time here? Choose GUIDED FLIGHT.');
  });

  it('a flight without guidance offers PRACTISE ALONE only, centred, and says why', () => {
    const pads = modeSelectScreen.pads!(ctx(FLIGHT_B));
    expect(pads).toEqual([{ id: 'auto', rect: AUTO_SOLO }]);
    expect(AUTO_SOLO.cx).toBe(0);
    checkPad('auto solo', SCREENS.small, AUTO_SOLO);
    expect(gap(AUTO_SOLO, SMALL_BUTTONS.continue)).toBeGreaterThanOrEqual(SCREEN_GAP - 1e-9);
    expect(modeHint(FLIGHT_B)).toBe('Bravo flight has no guided flight. You fly it on your own.');
    expect(modeHint(FLIGHT_B)).toMatch(/^[\x20-\x7e]*$/);
    // the sub line fits the wider button; the hint ends above it
    expect(measure('No guidance, graded as flown', 'body', 500)).toBeLessThanOrEqual(AUTO_SOLO.w);
    const width = SCREENS.small.size[0] - 2 * SCREEN_MARGIN;
    let words = 1;
    let line = '';
    for (const w of modeHint(FLIGHT_B).split(' ')) {
      const trial = line ? `${line} ${w}` : w;
      if (measure(trial, 'body', 500) <= width) line = trial;
      else {
        words++;
        line = w;
      }
    }
    const hintBottom = SCREENS.small.size[1] / 2 - SCREEN_MARGIN - lineHeightM('title') - words * lineHeightM('body');
    expect(hintBottom).toBeGreaterThanOrEqual(AUTO_SOLO.cy + AUTO_SOLO.h / 2);
  });
});

describe('screen host: picker presses (T41)', () => {
  it('a card press chooses that flight, and ui:flight:<id> finds the card', async () => {
    vi.resetModules();
    const { Object3D } = await import('@iwsdk/core');
    vi.doMock('../../src/xr/panels/draw', () => ({ ZoneCanvas: class {
      panel = { mesh: new Object3D(), markDirty: vi.fn(), tick: vi.fn(), setDraw: vi.fn() };
      text = vi.fn(); W = 1; H = 1;
      measurer() { return (text: string) => text.length / 1000; }
      measure(text: string) { return text.length / 1000; }
      clear() {} box() {} fill() {} rect() {} line() {}
    } }));
    const pads: Array<{ name: string; onPress: () => void; rect?: number[]; shown: boolean }> = [];
    vi.doMock('../../src/xr/panels/panelPad', () => ({ createPanelPad: (_w: unknown, _z: unknown, name: string, onPress: () => void) => {
      const p = { name, onPress, shown: false, rect: undefined as number[] | undefined };
      pads.push(p);
      return { rect(...r: number[]) { p.shown = true; p.rect = r; }, hide() { p.shown = false; }, press: () => 0, hover: () => 0, front: () => (p.shown ? { x: pads.indexOf(p), y: 0, z: 0 } : undefined) };
    } }));
    const { createScreens } = await import('../../src/app/screens/host');
    let change!: (s: string) => void;
    const app = { state: 'flightSelect', guided: false, flights: [FLIGHT_A, FLIGHT_B], flight: FLIGHT_A, onChange: (fn: typeof change) => { change = fn; }, debrief: () => [], chooseFlight: vi.fn() };
    const host = createScreens({ createTransformEntity: (o: unknown) => ({ object3D: o }) } as never, app as never, FLIGHT_A.build(0), { get: () => 0.1, step() {} });
    change('flightSelect');
    const shown = pads.filter((p) => p.shown && p.name.startsWith('screen.flight'));
    expect(shown.map((p) => p.name)).toEqual(['screen.flight0', 'screen.flight1']);
    expect(shown.map((p) => p.rect![0])).toEqual(flightCardRects(2).map((r) => r.cx));
    expect(host.targetPosition('ui:flight:fx-b')![0]).toBe(pads.findIndex((p) => p.name === 'screen.flight1'));
    expect(host.targetPosition('ui:flight:fx-a')![0]).toBe(pads.findIndex((p) => p.name === 'screen.flight0'));
    expect(host.targetPosition('ui:flight:nope')).toBeUndefined();
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10_000);
    pads.find((p) => p.name === 'screen.flight1')!.onPress();
    expect(app.chooseFlight).toHaveBeenCalledWith('fx-b');
    // the picker hides when another screen is shown
    app.state = 'modeSelect';
    change('modeSelect');
    expect(pads.filter((p) => p.shown && p.name.startsWith('screen.flight'))).toEqual([]);
    expect(pads.filter((p) => p.shown).map((p) => p.name).sort()).toEqual(['screen.auto', 'screen.guided']);
    app.flight = FLIGHT_B;
    change('modeSelect');
    expect(pads.filter((p) => p.shown).map((p) => p.name)).toEqual(['screen.auto']);
    vi.doUnmock('../../src/xr/panels/draw'); vi.doUnmock('../../src/xr/panels/panelPad'); vi.restoreAllMocks();
  });
});
