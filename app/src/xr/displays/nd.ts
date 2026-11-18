/** Navigation display face (0.22 x 0.16 m): heading-up compass arc, route line, storm cell. Generic symbology. */
import type { AircraftState } from '../../contracts/aircraft';
import { THEME } from '../theme';
import { clearDisplay, pad3, setFont, text, u } from './drawUtil';

const CX = 0.11;
const CY = 0.148;
const R = 0.115;
const HALF_ARC = 60;
const DEG = Math.PI / 180;

/** Bearing of `target` relative to `heading`, wrapped to [-180, 180). */
export function relativeBearing(target: number, heading: number): number {
  return ((((target - heading) % 360) + 540) % 360) - 180;
}

const px = (rel: number, r: number): [number, number] => [CX + r * Math.sin(rel * DEG), CY - r * Math.cos(rel * DEG)];

/** Display label for an airport id: the UPPER-CASED scenario name, or '' for an unknown id (never the raw id). */
export function destinationLabel(names: Readonly<Record<string, string>>, id: string): string {
  return Object.prototype.hasOwnProperty.call(names, id) ? names[id].toUpperCase() : '';
}

const LABEL_MAX_W = 0.1;

/** `destLabel` is the resolved, upper-cased name (see destinationLabel); blank draws nothing. */
export function drawNd(ctx: CanvasRenderingContext2D, s: AircraftState, destLabel = ''): void {
  clearDisplay(ctx);
  text(ctx, `HDG ${pad3(s.headingDeg)}`, 0.004, 0.012, 'body', THEME.display.normal);

  // compass arc with ticks every 10 degrees and numerals every 30
  ctx.strokeStyle = THEME.color.textDim;
  ctx.lineWidth = u(0.0009);
  ctx.beginPath();
  ctx.arc(u(CX), u(CY), u(R), (-90 - HALF_ARC) * DEG, (-90 + HALF_ARC) * DEG);
  ctx.stroke();
  const first = Math.ceil((s.headingDeg - HALF_ARC) / 10) * 10;
  for (let b = first; b <= s.headingDeg + HALF_ARC; b += 10) {
    const rel = b - s.headingDeg;
    const major = ((b % 30) + 30) % 30 === 0;
    const [x1, y1] = px(rel, R);
    const [x2, y2] = px(rel, R - (major ? 0.009 : 0.005));
    ctx.beginPath();
    ctx.moveTo(u(x1), u(y1));
    ctx.lineTo(u(x2), u(y2));
    ctx.stroke();
    if (major) {
      const [tx, ty] = px(rel, R - 0.018);
      text(ctx, pad3(b).slice(0, 2), tx, ty, 'min', THEME.color.textDim, 'center');
    }
  }
  // half-range ring (dashed)
  ctx.setLineDash([u(0.003), u(0.004)]);
  ctx.beginPath();
  ctx.arc(u(CX), u(CY), u(R / 2), (-90 - HALF_ARC) * DEG, (-90 + HALF_ARC) * DEG);
  ctx.stroke();
  ctx.setLineDash([]);

  // storm cell (nested contours: light outer, heavy core), bearing relative to heading
  if (s.stormBearingDeg !== null) {
    const rel = Math.max(-HALF_ARC + 5, Math.min(HALF_ARC - 5, relativeBearing(s.stormBearingDeg, s.headingDeg)));
    const [sx, sy] = px(rel, 0.072);
    for (const [r, c] of [[0.024, THEME.display.wxLight], [0.016, THEME.display.wxMid], [0.008, THEME.display.wxHeavy]] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(u(sx), u(sy), u(r), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // route line: own aircraft -> waypoint ahead -> destination
  const [w1x, w1y] = px(0, 0.06);
  const [w2x, w2y] = px(18, 0.1);
  ctx.strokeStyle = THEME.display.route;
  ctx.lineWidth = u(0.0016);
  ctx.beginPath();
  ctx.moveTo(u(CX), u(CY - 0.008));
  ctx.lineTo(u(w1x), u(w1y));
  ctx.lineTo(u(w2x), u(w2y));
  ctx.stroke();
  ctx.fillStyle = THEME.display.route;
  for (const [x, y] of [[w1x, w1y], [w2x, w2y]]) {
    ctx.beginPath();
    ctx.moveTo(u(x), u(y - 0.004));
    ctx.lineTo(u(x + 0.003), u(y));
    ctx.lineTo(u(x), u(y + 0.004));
    ctx.lineTo(u(x - 0.003), u(y));
    ctx.closePath();
    ctx.fill();
  }
  if (destLabel) {
    // bottom-right corner, clear of the compass numerals and the storm; shortened (ASCII "..") to fit
    setFont(ctx, 'min');
    let label = `TO ${destLabel}`;
    while (label.length > 4 && ctx.measureText(label).width > u(LABEL_MAX_W)) label = `${label.slice(0, -3)}..`;
    text(ctx, label, 0.216, 0.15, 'min', THEME.display.route, 'right');
  }

  // own-aircraft triangle and heading caret
  ctx.fillStyle = THEME.color.text;
  ctx.beginPath();
  ctx.moveTo(u(CX), u(CY - 0.008));
  ctx.lineTo(u(CX + 0.005), u(CY + 0.004));
  ctx.lineTo(u(CX - 0.005), u(CY + 0.004));
  ctx.closePath();
  ctx.fill();
  const [cx0, cy0] = px(0, R);
  ctx.beginPath();
  ctx.moveTo(u(cx0), u(cy0 + 0.001));
  ctx.lineTo(u(cx0 + 0.004), u(cy0 - 0.005));
  ctx.lineTo(u(cx0 - 0.004), u(cy0 - 0.005));
  ctx.closePath();
  ctx.fill();
}
