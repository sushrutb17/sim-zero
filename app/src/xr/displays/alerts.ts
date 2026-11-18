/** Alerts: the pure list model (reducer), plus the alerts display drawing. Plain ASCII text only. */
import type { AircraftState } from '../../contracts/aircraft';
import type { WorldCue } from '../../contracts/events';
import { THEME } from '../theme';
import { clearDisplay, text, u } from './drawUtil';

export type AlertLevel = 'warning' | 'caution' | 'advisory';

export interface ActiveAlert {
  id: string;
  level: AlertLevel;
  text: string;
  acked: boolean;
}

const RANK: Record<AlertLevel, number> = { warning: 0, caution: 1, advisory: 2 };

/**
 * Pure reducer. `alert` adds (appended = newest) or replaces by id: an identical re-send is a no-op
 * (keeps `acked`); a changed level or text becomes a fresh, unacked, newest entry. `alertClear` removes.
 * Every other cue returns the same list. The input is never mutated.
 */
export function alertsReducer(list: readonly ActiveAlert[], cue: WorldCue): ActiveAlert[] {
  if (cue.kind === 'alert') {
    const existing = list.find((a) => a.id === cue.id);
    if (existing && existing.level === cue.level && existing.text === cue.text) return list as ActiveAlert[];
    return [...list.filter((a) => a.id !== cue.id), { id: cue.id, level: cue.level, text: cue.text, acked: false }];
  }
  if (cue.kind === 'alertClear') {
    return list.some((a) => a.id === cue.id) ? list.filter((a) => a.id !== cue.id) : (list as ActiveAlert[]);
  }
  return list as ActiveAlert[];
}

/** Marks one alert acknowledged. Returns the same list when the id is unknown or already acked. */
export function ackAlert(list: readonly ActiveAlert[], id: string): ActiveAlert[] {
  const a = list.find((x) => x.id === id);
  if (!a || a.acked) return list as ActiveAlert[];
  return list.map((x) => (x.id === id ? { ...x, acked: true } : x));
}

/** Display order: warning > caution > advisory; within a level the newest (latest added) first. */
export function orderAlerts(list: readonly ActiveAlert[]): ActiveAlert[] {
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || y.i - x.i)
    .map((x) => x.a);
}

/** The alert an ACK press acknowledges: the first unacked in display order, if any. */
export function highestUnacked(list: readonly ActiveAlert[]): ActiveAlert | undefined {
  return orderAlerts(list).find((a) => !a.acked);
}

/** Mutable holder around the pure reducer, with a change callback for dirty-marking the display. */
export class AlertsModel {
  /** Same eligibility as panels/engine: paused or arming ACK presses must not mutate the list. */
  live = true;
  list: ActiveAlert[] = [];
  onChange?: () => void;

  apply(cue: WorldCue): void {
    const next = alertsReducer(this.list, cue);
    if (next !== this.list) {
      this.list = next;
      this.onChange?.();
    }
  }

  /** Replaces the whole list (session restart / redo). Always notifies, so the display redraws. */
  reset(list: readonly ActiveAlert[] = []): void {
    this.list = [...list];
    this.onChange?.();
  }

  /** Acknowledges the highest-priority unacked alert and returns its id (undefined = nothing to ack). */
  ackHighest(): string | undefined {
    if (!this.live) return undefined;
    const a = highestUnacked(this.list);
    if (!a) return undefined;
    this.list = ackAlert(this.list, a.id);
    this.onChange?.();
    return a.id;
  }

  hasUnackedWarning(): boolean {
    return this.list.some((a) => a.level === 'warning' && !a.acked);
  }
}

const ROW_X = 0.003;
const ROW_W = 0.146;
const ROW_H = 0.024;
const ROW_STEP = 0.027;
const ROW_Y0 = 0.024;
const MAX_ROWS = 4;

/**
 * Alerts display (0.19 x 0.16 m face). Unacked: warning = inverse box with a 1 Hz border pulse (`pulse`
 * toggles it), caution = amber outline box, advisory = plain cyan. Acked: no box, a solid left bar, text
 * dimmed. The top-right corner is left empty (the magnify tab sits there).
 */
export function drawAlerts(ctx: CanvasRenderingContext2D, alerts: readonly ActiveAlert[], gen: AircraftState['elec'], pulse = true): void {
  clearDisplay(ctx);
  const ordered = orderAlerts(alerts);
  text(ctx, ordered.length > MAX_ROWS ? `ALERTS +${ordered.length - MAX_ROWS}` : 'ALERTS', 0.004, 0.012, 'min', THEME.color.textDim);

  ordered.slice(0, MAX_ROWS).forEach((a, i) => {
    const y = ROW_Y0 + i * ROW_STEP;
    const color = THEME.alert[a.level];
    const textY = y + ROW_H / 2;
    if (a.acked) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillRect(u(ROW_X), u(y), u(0.004), u(ROW_H));
      ctx.globalAlpha = 0.55;
      text(ctx, a.text, ROW_X + 0.01, textY, 'body', color);
      ctx.globalAlpha = 1;
    } else if (a.level === 'warning') {
      ctx.fillStyle = color;
      ctx.fillRect(u(ROW_X), u(y), u(ROW_W), u(ROW_H));
      ctx.strokeStyle = pulse ? THEME.color.text : THEME.color.bezel;
      ctx.lineWidth = u(0.002);
      ctx.strokeRect(u(ROW_X + 0.001), u(y + 0.001), u(ROW_W - 0.002), u(ROW_H - 0.002));
      text(ctx, a.text, ROW_X + 0.008, textY, 'body', THEME.color.bezel);
    } else if (a.level === 'caution') {
      ctx.strokeStyle = color;
      ctx.lineWidth = u(0.002);
      ctx.strokeRect(u(ROW_X + 0.001), u(y + 0.001), u(ROW_W - 0.002), u(ROW_H - 0.002));
      text(ctx, a.text, ROW_X + 0.008, textY, 'body', color);
    } else {
      text(ctx, a.text, ROW_X + 0.008, textY, 'body', color);
    }
  });

  // generator status line (two cells)
  const cell = (label: string, g: { switchOn: boolean; failed: boolean }, x: number) => {
    const word = g.failed ? 'FAULT' : g.switchOn ? 'ON' : 'OFF';
    const color = g.failed ? THEME.alert.warning : g.switchOn ? THEME.display.normal : THEME.color.textDim;
    text(ctx, `${label} ${word}`, x, 0.148, 'body', color);
  };
  cell('GEN 1', gen.gen1, 0.004);
  cell('GEN 2', gen.gen2, 0.1);
}
