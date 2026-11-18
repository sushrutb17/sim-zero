/**
 * Debrief screen (Task 11, spec 4.5) on the large screen. One row per graded Event Set: number + title, Technical and
 * CRM focus, up to three reasons ("<REASON_LABELS[category]>: <text>"), the grade (1-4) with a HINT marker when a hint
 * was used, and a Redo pad. After a redo the row shows FIRST and REDO grades side by side, plus the redo's reasons.
 * Rows are variable height; when they do not all fit, they are paged (PREV / NEXT in the header). All text >= THEME body.
 * Pure layout (layoutDebrief) + canvas drawing through a ZoneCanvas (type-only import): testable in node.
 */
import type { DebriefRow } from '../debriefModel';
import type { ZoneCanvas } from '../../xr/panels/draw';
import { lineHeightM, packCards, wrapText } from '../../xr/panels/textLayout';
import type { TextRole } from '../../xr/displays/drawUtil';
import { THEME } from '../../xr/theme';
import { debriefGeo, redoRect, timelineRect } from './layout';
import { drawButton, drawFrame, type PadLevel } from './ui';

export type DebriefMeasure = (s: string, role: TextRole, weight: number) => number;

export interface DebriefLine {
  text: string;
  color: 'text' | 'dim';
  weight: number;
}

export interface LaidRow {
  rowIndex: number;
  lines: DebriefLine[];
  h: number;
}

export interface DebriefLayout {
  rows: LaidRow[];
  /** Each page lists rows with `top` measured down from the area top (metres). */
  pages: Array<Array<{ rowIndex: number; top: number; h: number }>>;
}

const BODY_LH = lineHeightM('body');
const TITLE_LH = lineHeightM('title');

/** Height of the grade column: label line, digit, optional HINT line. */
function gradeColumnH(row: DebriefRow): number {
  const hint = row.hintUsed || row.redoHintUsed;
  return BODY_LH + TITLE_LH + (hint ? BODY_LH : 0);
}

export function layoutDebrief(rows: readonly DebriefRow[], measure: DebriefMeasure): DebriefLayout {
  const g = debriefGeo();
  const wrap = (s: string, weight: number) => wrapText(s, g.text.w, (t) => measure(t, 'body', weight));
  const laid: LaidRow[] = rows.map((row, rowIndex) => {
    const lines: DebriefLine[] = [];
    const add = (s: string, color: DebriefLine['color'], weight: number) => {
      for (const l of wrap(s, weight)) lines.push({ text: l, color, weight });
    };
    add(`${rowIndex + 1}. ${row.title}`, 'text', 700);
    add(`Technical: ${row.technical}`, 'dim', 500);
    add(`CRM: ${row.crm}`, 'dim', 500);
    for (const r of row.reasons) add(`${r.label}: ${r.text}`, 'text', 500);
    if (row.comment) add(`Instructor: ${row.comment}`, 'text', 500);
    if (row.redoGrade !== undefined) {
      const rr = row.redoReasons ?? [];
      if (rr.length === 0) add('Redo: no issues noted.', 'text', 700);
      else for (const r of rr) add(`Redo - ${r.label}: ${r.text}`, 'text', 500);
    }
    const inner = Math.max(lines.length * BODY_LH, g.redo.h, gradeColumnH(row));
    return { rowIndex, lines, h: inner + 2 * g.rowInset };
  });
  const packed = packCards(
    laid.map((r) => r.h),
    g.area.h,
    g.rowGap,
  );
  return { rows: laid, pages: packed.map((p) => p.map((c) => ({ rowIndex: laid[c.index].rowIndex, top: c.y, h: c.h }))) };
}

export const DEBRIEF_TITLE = 'Debrief';
export const GUIDED_LABEL = 'GUIDED FLIGHT';
/** Left edge of the GUIDED FLIGHT label, given the drawn width of the title. */
export function guidedLabelX(titleWidth: number): number {
  return debriefGeo().header.titleX + titleWidth + debriefGeo().rowGap;
}
/** Right edge of the "Page n of N" label (drawn right-aligned, left of PREV). */
export function pageLabelRight(): number {
  const g = debriefGeo();
  return g.prev.cx - g.prev.w / 2 - 0.012;
}

export interface DebriefDrawState {
  rows: readonly DebriefRow[];
  layout: DebriefLayout;
  page: number;
  /** True for a guided flight: the header shows the GUIDED FLIGHT label after the title. */
  guided?: boolean;
  level(id: string): PadLevel;
}

/** Screen-local pad rects of everything pressable on `page` (redo:<eventSetId>, timeline:<eventSetId>, restart, finish, prev, next). */
export function debriefPads(rows: readonly DebriefRow[], layout: DebriefLayout, page: number): Array<{ id: string; rect: { cx: number; cy: number; w: number; h: number } }> {
  const g = debriefGeo();
  const out: Array<{ id: string; rect: { cx: number; cy: number; w: number; h: number } }> = [
    { id: 'restart', rect: g.restart },
    { id: 'finish', rect: g.finish },
  ];
  if (layout.pages.length > 1) {
    if (page > 0) out.push({ id: 'prev', rect: g.prev });
    if (page < layout.pages.length - 1) out.push({ id: 'next', rect: g.next });
  }
  for (const r of layout.pages[page] ?? []) {
    const id = rows[r.rowIndex].eventSetId;
    out.push({ id: `redo:${id}`, rect: redoRect(g.area.top - r.top) }, { id: `timeline:${id}`, rect: timelineRect(g.area.top - r.top) });
  }
  return out;
}

export function drawDebrief(zc: ZoneCanvas, s: DebriefDrawState): void {
  const g = debriefGeo();
  drawFrame(zc);
  zc.text(DEBRIEF_TITLE, g.header.titleX, g.header.cy, 'title', THEME.color.text, 'left', 700);
  // A guided flight is labelled next to the title, at body size in the trainer colour, so it stays clear of "Page n of N".
  if (s.guided) zc.text(GUIDED_LABEL, guidedLabelX(zc.measure(DEBRIEF_TITLE, 'title', 700)), g.header.cy, 'body', THEME.color.accent, 'left', 700);
  const pages = s.layout.pages.length;
  if (pages > 1) {
    zc.text(`Page ${s.page + 1} of ${pages}`, pageLabelRight(), g.header.cy, 'body', THEME.color.textDim, 'right', 600);
    if (s.page > 0) drawButton(zc, g.prev, 'PREV', s.level('prev'), 'neutral');
    if (s.page < pages - 1) drawButton(zc, g.next, 'NEXT', s.level('next'), 'neutral');
  }
  drawButton(zc, g.restart, 'RESTART', s.level('restart'));
  drawButton(zc, g.finish, 'FINISH', s.level('finish'));

  for (const placed of s.layout.pages[s.page] ?? []) {
    const row = s.rows[placed.rowIndex];
    const laid = s.layout.rows[placed.rowIndex];
    const top = g.area.top - placed.top;
    zc.box(0, top - placed.h / 2, g.W - 2 * 0.012, placed.h, null, { color: THEME.color.panelEdge, width: 0.0015 }, 0.006);
    laid.lines.forEach((l, i) =>
      zc.text(l.text, g.text.left, top - g.rowInset - BODY_LH * (i + 0.5), 'body', l.color === 'dim' ? THEME.color.textDim : THEME.color.text, 'left', l.weight),
    );
    // grade column
    const gy = top - g.rowInset;
    const gradeCol = (cx: number, label: string, grade: number, hint: boolean | undefined) => {
      zc.text(label, cx, gy - BODY_LH / 2, 'body', THEME.color.textDim, 'center', 700);
      zc.text(String(grade), cx, gy - BODY_LH - TITLE_LH / 2, 'title', THEME.color.text, 'center', 700);
      if (hint) zc.text('HINT', cx, gy - BODY_LH - TITLE_LH - BODY_LH / 2, 'body', THEME.color.accent, 'center', 700);
    };
    if (row.redoGrade === undefined) gradeCol(g.grade.cx, 'GRADE', row.grade, row.hintUsed);
    else {
      gradeCol(g.grade.cx - g.grade.w / 4, 'FIRST', row.grade, row.hintUsed);
      gradeCol(g.grade.cx + g.grade.w / 4, 'REDO', row.redoGrade, row.redoHintUsed);
    }
    const id = `redo:${row.eventSetId}`;
    drawButton(zc, redoRect(top), 'REDO', s.level(id));
    drawButton(zc, timelineRect(top), 'TIMELINE', s.level(`timeline:${row.eventSetId}`));
  }
}
