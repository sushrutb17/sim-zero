/**
 * Where the trainer screens float (Task 11). Pure (no IWSDK) so the reach / yaw / gap / line-of-sight tests run in node.
 * Positions are relative to HEAD_ANCHOR (the seated eye point), like the cockpit's ZONES, and every screen faces the anchor.
 *
 * - `small` (welcome, mode select, practice, briefing, paused, finished): in the windscreen, above the glareshield
 *   autopilot strip and below the overhead panel, 0.45 m from the eye. It hides no cockpit zone (tested), so the
 *   kneeboard (practice switch, briefing pages) and the instruments stay in view.
 * - `large` (debrief): closer and bigger, in front of the glareshield and displays. It covers them, which is fine
 *   because nothing in the cockpit is needed while the debrief is open.
 */
import type { FlightDef } from '../../scenarios/registry';
import { faceAnchor, type LayoutEntry, type Vec3 } from '../../xr/cockpit/layout';

export interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const DEG = Math.PI / 180;
function screenAt(dist: number, elevationDeg: number, size: readonly [number, number]): LayoutEntry {
  const pos: Vec3 = [0, dist * Math.sin(elevationDeg * DEG), -dist * Math.cos(elevationDeg * DEG)];
  return { pos, size, ...faceAnchor(pos) };
}

export const SCREENS = {
  small: screenAt(0.45, 8, [0.48, 0.22]),
  large: screenAt(0.45, -5, [0.72, 0.44]),
  /** Guided-flight coach strip: just above the small screen's centre, over the windscreen, visible only while flying. */
  coach: screenAt(0.45, 13, [0.46, 0.075]),
} as const;
export type ScreenSurface = keyof typeof SCREENS;

/** Inner margin, minimum gap between pads (visual-direction section 5) and standard button height. */
export const SCREEN_MARGIN = 0.012;
export const SCREEN_GAP = 0.012;
export const BUTTON_H = 0.045;

const [SW, SH] = SCREENS.small.size;
const bottomRight: Rect = { cx: SW / 2 - SCREEN_MARGIN - 0.07, cy: -SH / 2 + SCREEN_MARGIN + BUTTON_H / 2, w: 0.14, h: BUTTON_H };
/** Top right, above the paused screen's RESUME (T51): more than 10 cm of screen between the two pads. */
const topRight: Rect = { cx: bottomRight.cx, cy: SH / 2 - SCREEN_MARGIN - BUTTON_H / 2, w: 0.14, h: BUTTON_H };
const bottomCentre: Rect = { cx: 0, cy: -SH / 2 + SCREEN_MARGIN + BUTTON_H / 2, w: 0.16, h: BUTTON_H };

/**
 * Seat row (T40), on the bottom row of the welcome and paused screens, left of the CONTINUE / RESUME pad: SEAT FWD, the
 * current value, SEAT BACK, each SCREEN_GAP apart. Pad widths are the bold label at THEME body (Inter, screen-test
 * estimator: SEAT FWD 69.2 mm, SEAT BACK 76.1 mm) plus 6 mm each side, rounded up to the mm; the value slot holds the
 * widest label of the 0 to +50 cm range, "SEAT +30 cm" (87.1 mm bold; screens.test.ts measures every value), and is plain text, not a pad.
 */
const seatRowCy = bottomCentre.cy;
const seatFwdW = 0.082;
const seatLabelW = 0.092;
const seatBackW = 0.089;
const seatFwd: Rect = { cx: -SW / 2 + SCREEN_MARGIN + seatFwdW / 2, cy: seatRowCy, w: seatFwdW, h: BUTTON_H };
export const SEAT_LABEL_SLOT = { cx: seatFwd.cx + seatFwdW / 2 + SCREEN_GAP + seatLabelW / 2, cy: seatRowCy, w: seatLabelW } as const;
const seatBack: Rect = { cx: SEAT_LABEL_SLOT.cx + seatLabelW / 2 + SCREEN_GAP + seatBackW / 2, cy: seatRowCy, w: seatBackW, h: BUTTON_H };

/**
 * Flight picker (T41): up to three cards side by side under the title, in a row that stays clear of the bottom-right
 * CONTINUE press that brought the judge here (the card row ends 13 mm above it). One card is 0.26 m wide, two are 0.21 m,
 * three 0.144 m, always SCREEN_GAP apart and centred; every card is 0.10 m tall (title, up to three blurb lines, the length).
 */
export const MAX_FLIGHT_CARDS = 3;
export const FLIGHT_CARD_H = 0.1;
export const FLIGHT_CARD_CY = 0.01;
const FLIGHT_CARD_W = [0.26, 0.21, 0.144] as const;
/** Card rects for `n` flights (clamped to 1..MAX_FLIGHT_CARDS), left to right. */
export function flightCardRects(n: number): Rect[] {
  const count = Math.min(MAX_FLIGHT_CARDS, Math.max(1, Math.floor(n)));
  const w = FLIGHT_CARD_W[count - 1];
  const pitch = w + SCREEN_GAP;
  return Array.from({ length: count }, (_, i) => ({ cx: (i - (count - 1) / 2) * pitch, cy: FLIGHT_CARD_CY, w, h: FLIGHT_CARD_H }));
}
/** PRACTISE ALONE when GUIDED FLIGHT is not offered (the chosen flight has no guide steps): alone, centred. */
export const AUTO_SOLO: Rect = { cx: 0, cy: 0, w: 0.28, h: 0.075 };
const cards3 = flightCardRects(3);

/** Buttons of the small screens, screen-local metres (x right, y up, origin at the centre). */
export const SMALL_BUTTONS = {
  continue: bottomRight,
  /** Two-line cards side by side, clear of the CONTINUE press that brought the judge here. */
  guided: { cx: -0.115, cy: 0, w: 0.21, h: 0.075 },
  auto: { cx: 0.115, cy: 0, w: 0.21, h: 0.075 },
  /** The picker's card slots at their widest spread (three flights); the screen places the first n at flightCardRects(n). */
  flight0: cards3[0],
  flight1: cards3[1],
  flight2: cards3[2],
  begin: bottomRight,
  /** Bottom right like CONTINUE and BEGIN: the seat row takes the bottom row's left and middle (T40). */
  resume: bottomRight,
  seatFwd,
  seatBack,
  /** RESTART on the paused screen (T51): the far corner from RESUME, so a reach for RESUME cannot land on it. */
  abandon: topRight,
  again: bottomCentre,
} as const satisfies Record<string, Rect>;
export type SmallButtonId = keyof typeof SMALL_BUTTONS;

/** Debrief (large screen) geometry. Rows are laid out at runtime (variable height); the fixed parts live here. */
export function debriefGeo() {
  const [W, H] = SCREENS.large.size;
  const M = SCREEN_MARGIN;
  const headerCy = H / 2 - M - BUTTON_H / 2;
  const finish: Rect = { cx: W / 2 - M - 0.05, cy: headerCy, w: 0.1, h: BUTTON_H };
  const restart: Rect = { cx: finish.cx - finish.w / 2 - SCREEN_GAP - 0.055, cy: headerCy, w: 0.11, h: BUTTON_H };
  const next: Rect = { cx: restart.cx - restart.w / 2 - SCREEN_GAP - 0.035, cy: headerCy, w: 0.07, h: BUTTON_H };
  const prev: Rect = { cx: next.cx - next.w / 2 - SCREEN_GAP - 0.035, cy: headerCy, w: 0.07, h: BUTTON_H };
  const areaTop = headerCy - BUTTON_H / 2 - SCREEN_GAP;
  const areaBottom = -H / 2 + M;
  // Per-row pads, right to left: REDO, TIMELINE (same height, same row band), then the grade column, then the text.
  // Widths are the bold label at THEME body (Inter, measured with the screen tests' estimator: TIMELINE 61.7 mm,
  // REDO 36.4 mm) plus 6 mm each side, rounded up to the mm.
  const redoW = 0.049;
  const redoH = 0.04;
  const redoCx = W / 2 - M - redoW / 2;
  const timelineW = 0.074;
  const timelineCx = redoCx - redoW / 2 - SCREEN_GAP - timelineW / 2;
  const gradeW = 0.115;
  const gradeCx = timelineCx - timelineW / 2 - SCREEN_GAP - gradeW / 2;
  const textLeft = -W / 2 + M + 0.006;
  const textRight = gradeCx - gradeW / 2 - SCREEN_GAP;
  return {
    W,
    H,
    header: { cy: headerCy, titleX: -W / 2 + M },
    finish,
    restart,
    next,
    prev,
    area: { top: areaTop, bottom: areaBottom, h: areaTop - areaBottom },
    rowGap: SCREEN_GAP,
    rowInset: 0.006,
    redo: { cx: redoCx, w: redoW, h: redoH },
    timeline: { cx: timelineCx, w: timelineW, h: redoH },
    grade: { cx: gradeCx, w: gradeW },
    text: { left: textLeft, right: textRight, w: textRight - textLeft },
  };
}

/** Redo pad of a row whose top edge is `rowTop` (screen-local y). */
export function redoRect(rowTop: number): Rect {
  const g = debriefGeo();
  return { cx: g.redo.cx, cy: rowTop - g.rowInset - g.redo.h / 2, w: g.redo.w, h: g.redo.h };
}

/** Timeline pad of a row whose top edge is `rowTop` (screen-local y): beside REDO, same height and row band. */
export function timelineRect(rowTop: number): Rect {
  const g = debriefGeo();
  return { cx: g.timeline.cx, cy: rowTop - g.rowInset - g.timeline.h / 2, w: g.timeline.w, h: g.timeline.h };
}

/**
 * Timeline view of one Event Set on the large screen (T29). BACK takes the debrief's FINISH place, PREV and NEXT keep
 * theirs, so a finger that pressed TIMELINE never lands on a different pad. Time column at `timeX`, text at `textX`.
 */
export function timelineGeo() {
  const d = debriefGeo();
  const timeX = d.text.left;
  const textX = timeX + 0.055;
  const right = d.W / 2 - SCREEN_MARGIN - 0.006;
  return {
    W: d.W,
    H: d.H,
    header: { cy: d.header.cy, titleX: d.header.titleX },
    /** Widest header (bold, body size: title size is too wide for the longest Event Set title) that clears PREV, which may be shown. */
    titleMaxW: d.prev.cx - d.prev.w / 2 - SCREEN_GAP - d.header.titleX,
    back: d.finish,
    next: d.next,
    prev: d.prev,
    /** "Page n of N" is drawn right-aligned here, in the free RESTART place. */
    pageLabelRight: d.finish.cx - d.finish.w / 2 - SCREEN_GAP,
    area: d.area,
    timeX,
    textX,
    textW: right - textX,
  };
}

/** How many redo and timeline pads the debrief needs: one per Event Set of the largest flight (each flight measured at its baseline). */
export function padPoolSize(flights: readonly Pick<FlightDef, 'build'>[]): number {
  return Math.max(1, ...flights.map((f) => f.build(0).eventSets.length));
}
