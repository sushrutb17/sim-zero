/** Primary flight display face (0.19 x 0.16 m). Generic symbology: simple horizon, speed, altitude, heading, AP modes. */
import type { AircraftState } from '../../contracts/aircraft';
import { THEME } from '../theme';
import { clearDisplay, fitText, pad3, text, u } from './drawUtil';

const ADI = { x: 0.048, y: 0.024, w: 0.088, h: 0.11 };
const PITCH_M_PER_DEG = 0.0016;

/** Cosmetic pitch from the flight phase (the state carries no pitch): level on the ground and in cruise. */
export function pitchForPhase(phase: AircraftState['phase']): number {
  return phase === 'takeoff' ? 8 : phase === 'climb' ? 5 : 0;
}

export function drawPfd(ctx: CanvasRenderingContext2D, s: AircraftState): void {
  clearDisplay(ctx);

  // active AP modes (header; the top-right corner is the magnify tab)
  const apOn = s.ap.engaged;
  const modeColor = apOn ? THEME.display.normal : THEME.color.textDim;
  text(ctx, 'AP', 0.004, 0.012, 'body', modeColor);
  text(ctx, s.ap.lateral === 'nav' ? 'NAV' : 'HDG', 0.038, 0.012, 'body', modeColor);
  text(ctx, s.ap.vertical === 'climb' ? 'CLB' : 'HOLD', 0.08, 0.012, 'body', modeColor);

  // attitude window: sky/ground split at the horizon (level, shifted for the phase pitch)
  const cx = ADI.x + ADI.w / 2;
  const cy = ADI.y + ADI.h / 2;
  const horizon = cy + pitchForPhase(s.phase) * PITCH_M_PER_DEG;
  ctx.save();
  ctx.beginPath();
  ctx.rect(u(ADI.x), u(ADI.y), u(ADI.w), u(ADI.h));
  ctx.clip();
  ctx.fillStyle = THEME.display.adiSky;
  ctx.fillRect(u(ADI.x), u(ADI.y), u(ADI.w), u(horizon - ADI.y));
  ctx.fillStyle = THEME.display.adiGround;
  ctx.fillRect(u(ADI.x), u(horizon), u(ADI.w), u(ADI.y + ADI.h - horizon));
  ctx.strokeStyle = THEME.color.text;
  ctx.lineWidth = u(0.0012);
  ctx.beginPath();
  ctx.moveTo(u(ADI.x), u(horizon));
  ctx.lineTo(u(ADI.x + ADI.w), u(horizon));
  ctx.stroke();
  // fixed aircraft symbol
  ctx.lineWidth = u(0.002);
  ctx.beginPath();
  ctx.moveTo(u(cx - 0.026), u(cy));
  ctx.lineTo(u(cx - 0.008), u(cy));
  ctx.lineTo(u(cx - 0.008), u(cy + 0.005));
  ctx.moveTo(u(cx + 0.026), u(cy));
  ctx.lineTo(u(cx + 0.008), u(cy));
  ctx.lineTo(u(cx + 0.008), u(cy + 0.005));
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = THEME.color.textDim;
  ctx.lineWidth = u(0.0008);
  ctx.strokeRect(u(ADI.x), u(ADI.y), u(ADI.w), u(ADI.h));

  // speed (left) and altitude (right) boxes
  const box = (x: number, w: number) => {
    ctx.strokeStyle = THEME.color.textDim;
    ctx.lineWidth = u(0.0008);
    ctx.strokeRect(u(x), u(0.045), u(w), u(0.09));
  };
  box(0.002, 0.04);
  text(ctx, 'SPD', 0.022, 0.054, 'min', THEME.color.textDim, 'center');
  fitText(ctx, String(Math.round(s.speedKt)), 0.022, 0.085, 0.034, ['readout', 'body'], THEME.color.text);
  text(ctx, 'KT', 0.022, 0.12, 'min', THEME.color.textDim, 'center');

  box(0.142, 0.046);
  text(ctx, 'ALT', 0.165, 0.054, 'min', THEME.color.textDim, 'center');
  fitText(ctx, String(Math.round(s.altitudeFt / 10) * 10), 0.165, 0.085, 0.042, ['readout', 'body'], THEME.color.text);
  text(ctx, 'SEL', 0.165, 0.106, 'min', THEME.color.textDim, 'center');
  fitText(ctx, String(Math.round(s.ap.alt)), 0.165, 0.122, 0.042, ['min'], THEME.display.normal);

  // heading
  text(ctx, 'HDG', 0.058, 0.148, 'min', THEME.color.textDim, 'right');
  text(ctx, pad3(s.headingDeg), 0.064, 0.148, 'readout', THEME.color.text, 'left');
}
