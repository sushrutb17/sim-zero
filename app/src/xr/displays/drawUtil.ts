/**
 * Shared canvas-drawing helpers for the display faces (PFD, ND, alerts, overhead strip).
 *
 * PX_PER_M = 2400 canvas pixels per metre. Why: the design viewing distance is 0.6 m and THEME assumes an
 * effective 20 pixels/degree there (visual-direction.md section 4); 1 degree at 0.6 m is 10.5 mm, so the
 * panel needs >= 1900 px/m for the headset's pixels to out-resolve nothing the canvas lacks. 2400 gives
 * ~25 canvas px/deg at the PFD (0.62 m), a 7.5 mm minimum cap height of 18 px (>= the 14 px rule) and keeps
 * the 1.6x magnified view (0.45 m) at ~12 px/deg. A 0.19 x 0.16 m face is only 456 x 384 px.
 */
import { THEME, fontSizeForCap } from '../theme';

export const PX_PER_M = 2400;

/** Metres to canvas pixels. */
export const u = (m: number): number => m * PX_PER_M;

export type TextRole = keyof typeof THEME.text.capM;

/** Sets ctx.font so capital letters reach the THEME cap height for `role` (Inter if present, else a plain sans). */
export function setFont(ctx: CanvasRenderingContext2D, role: TextRole, weight = 600): void {
  ctx.font = `${weight} ${u(fontSizeForCap(THEME.text.capM[role])).toFixed(1)}px Inter, "Helvetica Neue", Arial, sans-serif`;
}

export function pad3(v: number): string {
  return String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0');
}

/** Fills the whole canvas with the display background. */
export function clearDisplay(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.display.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Draws text at metre coordinates (x, y = vertical centre) in the given role and colour. */
export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  xM: number,
  yM: number,
  role: TextRole,
  color: string,
  align: CanvasTextAlign = 'left',
  weight = 600,
): void {
  setFont(ctx, role, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, u(xM), u(yM));
}

/** Like text() but drops to the next smaller role if the string would be wider than maxWM. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  s: string,
  xM: number,
  yM: number,
  maxWM: number,
  roles: TextRole[],
  color: string,
  align: CanvasTextAlign = 'center',
): void {
  let used = roles[roles.length - 1];
  for (const r of roles) {
    setFont(ctx, r);
    if (ctx.measureText(s).width <= u(maxWM)) {
      used = r;
      break;
    }
  }
  text(ctx, s, xM, yM, used, color, align);
}
