/**
 * Shared drawing for the trainer screens (canvas, screen-local metres via ZoneCanvas). THEME tokens only.
 * Trainer layer (visual-direction sections 1 and 5): Continue / Begin / Redo / Restart / Finish / Resume are filled
 * `accent` buttons with `bezel` text; hover and press shift the fill to `hover` / `pressed`.
 * Type-only imports keep this module loadable in node tests.
 */
import type { Scenario } from '../../contracts/scenario';
import type { FlightDef } from '../../scenarios/registry';
import type { ZoneCanvas } from '../../xr/panels/draw';
import { lineHeightM, wrapText } from '../../xr/panels/textLayout';
import { THEME } from '../../xr/theme';
import { SEAT_LABEL_SLOT, SMALL_BUTTONS, type Rect } from './layout';
import { seatLabel } from '../../xr/seatMath';

export type PadLevel = 'idle' | 'hover' | 'press';

export interface ScreenCtx {
  scenario: Scenario;
  /** The flights on offer, in picker order (T41). */
  flights: readonly FlightDef[];
  /** The flight picked on the picker: what the mode screen is about. */
  flight: FlightDef;
  /** Hover/press state of a button on this screen. */
  level(id: string): PadLevel;
  /** The seat offset now, metres (T40): the value between SEAT FWD and SEAT BACK. */
  seatOffset(): number;
}

export interface SmallScreen {
  /** Ids from SMALL_BUTTONS shown on this screen (every pad the screen can ever show). */
  buttons: readonly string[];
  /** The pads shown right now with their rects, when that depends on the context (the picker's card count, no GUIDED FLIGHT). Default: `buttons` at their SMALL_BUTTONS rects. */
  pads?(ctx: ScreenCtx): ReadonlyArray<{ id: string; rect: Rect }>;
  draw(zc: ZoneCanvas, ctx: ScreenCtx): void;
}

export function drawButton(zc: ZoneCanvas, r: Rect, label: string, level: PadLevel, variant: 'accent' | 'neutral' | 'outline' = 'accent', sub?: string): void {
  if (variant === 'accent') {
    const fill = level === 'press' ? THEME.color.pressed : level === 'hover' ? THEME.color.hover : THEME.color.accent;
    zc.box(r.cx, r.cy, r.w, r.h, fill, level === 'idle' ? undefined : { color: THEME.color.text, width: 0.002 }, 0.006);
  } else if (variant === 'outline') {
    // trainer layer, like the kneeboard's HINT and PAUSE: dark fill, violet outline and label
    const fill = level === 'press' ? THEME.color.pressedFill : level === 'hover' ? THEME.color.hoverFill : THEME.color.panelEdge;
    zc.box(r.cx, r.cy, r.w, r.h, fill, { color: THEME.color.accent, width: 0.002 }, 0.006);
  } else {
    const fill = level === 'press' ? THEME.color.pressedFill : level === 'hover' ? THEME.color.hoverFill : THEME.color.panelEdge;
    zc.box(r.cx, r.cy, r.w, r.h, fill, level === 'idle' ? undefined : { color: THEME.color.accent, width: 0.002 }, 0.006);
  }
  const color = variant === 'accent' ? THEME.color.bezel : variant === 'outline' ? THEME.color.accent : THEME.color.text;
  if (sub) {
    const lh = lineHeightM('body');
    zc.text(label, r.cx, r.cy + lh / 2, 'body', color, 'center', 700);
    zc.text(sub, r.cx, r.cy - lh / 2, 'body', color, 'center', 500);
  } else {
    zc.text(label, r.cx, r.cy, 'body', color, 'center', 700);
  }
}

/** Screen face: panel fill with a thin accent frame (the trainer speaks in violet). */
export function drawFrame(zc: ZoneCanvas): void {
  zc.clear();
  zc.box(0, 0, zc.W - 0.003, zc.H - 0.003, null, { color: THEME.color.accent, width: 0.0015 }, 0.008);
}

/** Title at the top-left; returns the y of its bottom edge. */
export function drawTitle(zc: ZoneCanvas, title: string, margin: number): number {
  const lh = lineHeightM('title');
  const top = zc.H / 2 - margin;
  zc.text(title, -zc.W / 2 + margin, top - lh / 2, 'title', THEME.color.text, 'left', 700);
  return top - lh;
}

/** Wrapped body paragraph from `top`; returns the y below it. */
export function drawParagraph(zc: ZoneCanvas, text: string, left: number, top: number, width: number, color: string = THEME.color.text, weight = 500): number {
  const lh = lineHeightM('body');
  const lines = wrapText(text, width, zc.measurer('body', weight));
  lines.forEach((l, i) => zc.text(l, left, top - lh * (i + 0.5), 'body', color, 'left', weight));
  return top - lh * lines.length;
}

/** SEAT FWD, the current value and SEAT BACK on the bottom row (T40). Shared by the welcome and paused screens. */
export function drawSeatRow(zc: ZoneCanvas, ctx: ScreenCtx): void {
  drawButton(zc, SMALL_BUTTONS.seatFwd, 'SEAT FWD', ctx.level('seatFwd'), 'outline');
  zc.text(seatLabel(ctx.seatOffset()), SEAT_LABEL_SLOT.cx, SEAT_LABEL_SLOT.cy, 'body', THEME.color.text, 'center', 700);
  drawButton(zc, SMALL_BUTTONS.seatBack, 'SEAT BACK', ctx.level('seatBack'), 'outline');
}
