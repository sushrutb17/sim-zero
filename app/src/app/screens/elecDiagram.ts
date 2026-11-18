/**
 * Electrical diagram strip (T30): up to three small power diagrams (START, AT FAULT, END) side by side above the log on
 * page 0 of the debrief timeline view. The picture is a teaching aid for a generic training aircraft, not a real system.
 *
 * Pure layout (`elecLabels`, `layoutElecStrip`) plus canvas drawing through a ZoneCanvas (type-only import), so it runs in
 * node tests. State is never shown by colour alone: every box carries its words. All text is printable ASCII at THEME body.
 * Coordinates: x is panel-local metres like the rest of the timeline view; `top` values are metres below the strip top.
 */
import { elecCaption, genOnline, busStatus, type Elec, type ElecMoment } from '../../engine/power';
import { formatClock } from '../../engine/timeline';
import type { ZoneCanvas } from '../../xr/panels/draw';
import { lineHeightM, wrapText } from '../../xr/panels/textLayout';
import { THEME } from '../../xr/theme';
import { timelineGeo } from './layout';

/** Height reserved at the top of page 0 for the strip, foot line included (measured in tests with the Inter estimator). */
export const ELEC_STRIP_H = 0.205;
export const ELEC_FOOT = 'Generic training aircraft. Not a real aircraft system.';
/** Horizontal padding between a box edge and its words. */
export const ELEC_BOX_PAD_X = 0.004;

export interface ElecLabels {
  head: string;
  gen1: string;
  gen2: string;
  bus1: string;
  bus2: string;
  tie: string;
  backup: string;
  caption: string;
}

const genLabel = (n: 1 | 2, e: Elec): string => {
  const g = n === 1 ? e.gen1 : e.gen2;
  return `GEN ${n} ${g.failed ? 'FAILED' : g.switchOn ? 'ON' : 'OFF'}`;
};

/** The words of one diagram. A failed generator reads FAILED whatever its switch says. */
export function elecLabels(m: ElecMoment): ElecLabels {
  const e = m.elec;
  const bus = busStatus(e);
  return {
    head: m.label === 'START' ? 'START' : `${m.label} ${formatClock(m.tSec)}`,
    gen1: genLabel(1, e),
    gen2: genLabel(2, e),
    bus1: `BUS 1 ${bus.bus1 ? 'POWERED' : 'NO POWER'}`,
    bus2: `BUS 2 ${bus.bus2 ? 'POWERED' : 'NO POWER'}`,
    tie: e.busTie ? 'TIE ON' : 'TIE OFF',
    backup: e.backupGenInop ? 'BACKUP GEN INOP' : 'BACKUP GEN',
    caption: elecCaption(e),
  };
}

export type ElecBoxKey = 'gen1' | 'gen2' | 'bus1' | 'bus2' | 'tie' | 'backup';
export interface ElecBox {
  key: ElecBoxKey;
  cx: number;
  /** Top edge, metres below the strip top. */
  top: number;
  w: number;
  h: number;
  /** The words, one or two lines, drawn bold at body size. */
  lines: string[];
}
export interface ElecColumn {
  cx: number;
  w: number;
  headTop: number;
  boxes: ElecBox[];
  caption: string[];
  captionTop: number;
}
export interface ElecStripLayout {
  columns: ElecColumn[];
  foot: { text: string; top: number };
  /** Height the strip needs, foot line included. Must not exceed ELEC_STRIP_H. */
  height: number;
}

const LH = lineHeightM('body');
const COL_GAP = 0.012;
const BOX_GAP = 0.016;
const BOX_PAD_Y = 0.003;
const HEAD_GAP = 0.002;
const CONNECT = 0.008;
const ROW_GAP = 0.004;
const FOOT_GAP = 0.003;
const BOLD = 700;
const MEDIUM = 500;

const boxH = (lines: number): number => lines * LH + 2 * BOX_PAD_Y;

/** One line when it fits, else the first two words ("BUS 1") over the rest ("NO POWER"). */
function splitLabel(label: string, maxW: number, measure: (s: string, weight: number) => number): string[] {
  if (measure(label, BOLD) <= maxW) return [label];
  const [a, b, ...rest] = label.split(' ');
  return [`${a} ${b}`, rest.join(' ')];
}

/** Where everything goes, in metres, for `measure(text, weight)` = drawn width at body size. */
export function layoutElecStrip(moments: readonly ElecMoment[], measure: (s: string, weight: number) => number): ElecStripLayout {
  const n = moments.length;
  if (n === 0) return { columns: [], foot: { text: ELEC_FOOT, top: 0 }, height: 0 };
  const g = timelineGeo();
  const left = g.timeX;
  const stripW = g.textX + g.textW - g.timeX;
  const colW = (stripW - (n - 1) * COL_GAP) / n;
  const boxW = (colW - BOX_GAP) / 2;
  const inner = boxW - 2 * ELEC_BOX_PAD_X;

  const labels = moments.map(elecLabels);
  const split = labels.map((l) => ({
    gen1: splitLabel(l.gen1, inner, measure),
    gen2: splitLabel(l.gen2, inner, measure),
    bus1: splitLabel(l.bus1, inner, measure),
    bus2: splitLabel(l.bus2, inner, measure),
  }));
  const genLines = Math.max(...split.flatMap((s) => [s.gen1.length, s.gen2.length]));
  const busLines = Math.max(...split.flatMap((s) => [s.bus1.length, s.bus2.length]));
  const captions = labels.map((l) => wrapText(l.caption, colW, (t) => measure(t, MEDIUM)));
  const captionLines = Math.max(...captions.map((c) => c.length));

  // Rows, top-down. Every column shares them so the diagrams line up.
  const headTop = 0;
  const genTop = LH + HEAD_GAP;
  const genH = boxH(genLines);
  const busTop = genTop + genH + CONNECT;
  const busH = boxH(busLines);
  const tieTop = busTop + busH + ROW_GAP;
  const tieH = boxH(1);
  const backupTop = tieTop + tieH + ROW_GAP;
  const captionTop = backupTop + boxH(1) + ROW_GAP;
  const contentEnd = captionTop + captionLines * LH;
  const height = contentEnd + FOOT_GAP + LH;

  const columns: ElecColumn[] = moments.map((_, i) => {
    const cx = left + colW / 2 + i * (colW + COL_GAP);
    const lx = cx - (boxW + BOX_GAP) / 2;
    const rx = cx + (boxW + BOX_GAP) / 2;
    const l = labels[i];
    const s = split[i];
    const tieW = measure(l.tie, BOLD) + 2 * ELEC_BOX_PAD_X;
    const backupW = measure(l.backup, BOLD) + 2 * ELEC_BOX_PAD_X;
    return {
      cx,
      w: colW,
      headTop,
      boxes: [
        { key: 'gen1', cx: lx, top: genTop, w: boxW, h: genH, lines: s.gen1 },
        { key: 'gen2', cx: rx, top: genTop, w: boxW, h: genH, lines: s.gen2 },
        { key: 'bus1', cx: lx, top: busTop, w: boxW, h: busH, lines: s.bus1 },
        { key: 'bus2', cx: rx, top: busTop, w: boxW, h: busH, lines: s.bus2 },
        { key: 'tie', cx, top: tieTop, w: tieW, h: tieH, lines: [l.tie] },
        { key: 'backup', cx, top: backupTop, w: backupW, h: boxH(1), lines: [l.backup] },
      ],
      caption: captions[i],
      captionTop,
    };
  });
  // The foot line sits at the bottom of the reserved height, so the log below always starts at the same place.
  return { columns, foot: { text: ELEC_FOOT, top: Math.max(ELEC_STRIP_H, height) - LH }, height };
}

const BOX_STROKE = 0.0015;
const LINK_W = 0.002;

function line(zc: ZoneCanvas, x1: number, y1: number, x2: number, y2: number, on: boolean): void {
  if (on) zc.line(x1, y1, x2, y2, THEME.display.normal, LINK_W);
  else zc.line(x1, y1, x2, y2, THEME.color.textDim, LINK_W, true);
}

/** A dashed rectangle outline (ZoneCanvas.box cannot dash): four dashed edges. */
function dashedOutline(zc: ZoneCanvas, cx: number, cy: number, w: number, h: number, color: string): void {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  zc.line(x0, y1, x1, y1, color, BOX_STROKE * 1.5, true);
  zc.line(x1, y1, x1, y0, color, BOX_STROKE * 1.5, true);
  zc.line(x1, y0, x0, y0, color, BOX_STROKE * 1.5, true);
  zc.line(x0, y0, x0, y1, color, BOX_STROKE * 1.5, true);
}

/** Draw the strip with its top edge at panel-local y = `top`. Nothing when there are no moments. */
export function drawElecStrip(zc: ZoneCanvas, top: number, moments: readonly ElecMoment[]): void {
  if (moments.length === 0) return;
  const lay = layoutElecStrip(moments, (s, weight) => zc.measure(s, 'body', weight));
  moments.forEach((m, i) => {
    const col = lay.columns[i];
    const e = m.elec;
    const bus = busStatus(e);
    const box = (key: ElecBoxKey): ElecBox => col.boxes.find((b) => b.key === key)!;
    const cy = (b: ElecBox) => top - b.top - b.h / 2;
    const bottom = (b: ElecBox) => top - b.top - b.h;
    const upper = (b: ElecBox) => top - b.top;

    zc.text(elecLabels(m).head, col.cx, top - col.headTop - LH / 2, 'body', THEME.color.text, 'center', BOLD);

    const words = (b: ElecBox, color: string) =>
      b.lines.forEach((t, k) => zc.text(t, b.cx, cy(b) + ((b.lines.length - 1) / 2 - k) * LH, 'body', color, 'center', BOLD));

    // generators (outline) and the link to their bus
    for (const [key, busKey, g] of [['gen1', 'bus1', e.gen1], ['gen2', 'bus2', e.gen2]] as const) {
      const b = box(key);
      const online = genOnline(g);
      const stroke = g.failed ? THEME.alert.warning : online ? THEME.display.normal : THEME.color.textDim;
      zc.box(b.cx, cy(b), b.w, b.h, null, { color: stroke, width: BOX_STROKE * 1.5 });
      words(b, THEME.color.text);
      line(zc, b.cx, bottom(b), b.cx, upper(box(busKey)), online);
    }
    // buses: powered = filled, unpowered = outline
    for (const [key, powered] of [['bus1', bus.bus1], ['bus2', bus.bus2]] as const) {
      const b = box(key);
      if (powered) zc.box(b.cx, cy(b), b.w, b.h, THEME.display.normal);
      else zc.box(b.cx, cy(b), b.w, b.h, null, { color: THEME.color.textDim, width: BOX_STROKE * 1.5 });
      words(b, powered ? THEME.color.bezel : THEME.color.text);
    }
    // tie: from each bus bottom down to the tie box's row, then across to the box
    const tie = box('tie');
    for (const key of ['bus1', 'bus2'] as const) {
      const b = box(key);
      const edge = b.cx < col.cx ? tie.cx - tie.w / 2 : tie.cx + tie.w / 2;
      line(zc, b.cx, bottom(b), b.cx, cy(tie), e.busTie);
      line(zc, b.cx, cy(tie), edge, cy(tie), e.busTie);
    }
    zc.box(tie.cx, cy(tie), tie.w, tie.h, THEME.color.panel, { color: e.busTie ? THEME.display.normal : THEME.color.textDim, width: BOX_STROKE * 1.5 });
    words(tie, THEME.color.text);
    // backup generator: dashed caution outline when inoperative
    const backup = box('backup');
    if (e.backupGenInop) dashedOutline(zc, backup.cx, cy(backup), backup.w, backup.h, THEME.alert.caution);
    else zc.box(backup.cx, cy(backup), backup.w, backup.h, null, { color: THEME.color.panelEdge, width: BOX_STROKE * 1.5 });
    words(backup, THEME.color.text);

    col.caption.forEach((t, k) => zc.text(t, col.cx - col.w / 2, top - col.captionTop - LH * (k + 0.5), 'body', THEME.color.text, 'left', MEDIUM));
  });
  zc.text(lay.foot.text, timelineGeo().timeX, top - lay.foot.top - LH / 2, 'body', THEME.color.textDim, 'left', MEDIUM);
}
