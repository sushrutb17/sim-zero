/**
 * Canvas drawing for the panels, in ZONE-LOCAL metres (x right, y up, origin at the zone centre) so the draw code
 * uses the same numbers as layout.ts. All text goes through setFont(role) so it can never be smaller than THEME.
 */
import { createCanvasPanel, type CanvasPanel } from '../displays/canvasPanel';
import { PX_PER_M, setFont, type TextRole } from '../displays/drawUtil';
import { THEME } from '../theme';
import { lineHeightM } from './textLayout';

export { lineHeightM };

export class ZoneCanvas {
  readonly panel: CanvasPanel;
  readonly ctx: CanvasRenderingContext2D;
  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    this.panel = createCanvasPanel(W, H, PX_PER_M);
    this.ctx = this.panel.ctx;
  }
  px = (x: number): number => (x + this.W / 2) * PX_PER_M;
  py = (y: number): number => (this.H / 2 - y) * PX_PER_M;

  clear(): void {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = THEME.color.panel;
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  /** Rounded rectangle centred at (cx, cy). */
  box(cx: number, cy: number, w: number, h: number, fill: string | null, stroke?: { color: string; width: number }, r = 0.004): void {
    const c = this.ctx;
    const x = this.px(cx - w / 2);
    const y = this.py(cy + h / 2);
    c.beginPath();
    c.roundRect(x, y, w * PX_PER_M, h * PX_PER_M, r * PX_PER_M);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.lineWidth = stroke.width * PX_PER_M;
      c.strokeStyle = stroke.color;
      c.stroke();
    }
  }

  /** Straight line between two points in zone-local metres; `dashed` draws a 5 mm dash with a 3 mm gap and resets the dash after. */
  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number, dashed = false): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(this.px(x1), this.py(y1));
    c.lineTo(this.px(x2), this.py(y2));
    c.lineWidth = width * PX_PER_M;
    c.strokeStyle = color;
    if (dashed) c.setLineDash([0.005 * PX_PER_M, 0.003 * PX_PER_M]);
    c.stroke();
    if (dashed) c.setLineDash([]);
  }

  /** Text with its vertical centre at y; x is the left edge, centre or right edge according to `align`. */
  text(s: string, x: number, y: number, role: TextRole, color: string, align: CanvasTextAlign = 'left', weight = 600): void {
    setFont(this.ctx, role, weight);
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = color;
    this.ctx.fillText(s, this.px(x), this.py(y));
  }

  /** Width in metres of `s` at `role`. */
  measure(s: string, role: TextRole, weight = 600): number {
    setFont(this.ctx, role, weight);
    return this.ctx.measureText(s).width / PX_PER_M;
  }

  /** Measure function for wrapText at a role. */
  measurer(role: TextRole, weight = 600): (s: string) => number {
    return (s) => this.measure(s, role, weight);
  }

  /** Draw lines top-down from `topY` (top of the first line); returns the y below the last line. */
  lines(lines: readonly string[], x: number, topY: number, role: TextRole, color: string, align: CanvasTextAlign = 'left', weight = 500): number {
    const lh = lineHeightM(role);
    lines.forEach((l, i) => this.text(l, x, topY - lh * (i + 0.5), role, color, align, weight));
    return topY - lh * lines.length;
  }
}
