/**
 * Timeline view (T29): the debrief's per-Event-Set record of what the scenario sent and what the pilot did, on the large
 * screen. Pure layout (layoutTimeline, timelinePads) plus canvas drawing through a ZoneCanvas (type-only import), so it
 * runs in node tests. All text is printable ASCII (the builder guarantees it) at THEME body or title size.
 */
import type { ElecMoment } from '../../engine/power';
import type { TimelineEntry } from '../../engine/timeline';
import { formatClock } from '../../engine/timeline';
import type { ZoneCanvas } from '../../xr/panels/draw';
import { lineHeightM, wrapText } from '../../xr/panels/textLayout';
import { THEME } from '../../xr/theme';
import { drawElecStrip } from './elecDiagram';
import { timelineGeo, type Rect } from './layout';
import { drawButton, drawFrame, type PadLevel } from './ui';

export interface TimelineLine {
  /** `m:ss`, or '' on a wrapped continuation line and on the notes at the end. */
  clock: string;
  /** What is drawn at the text column. A pilot entry's first line starts with `YOU  `. */
  text: string;
  /** Pilot lines are bold and bright; event lines (and the notes) are dimmer. */
  you: boolean;
}

export interface TimelineLayout {
  pages: TimelineLine[][];
  /** Height left free at the top of page 0 (the later diagram); 0 when none. */
  reserveH: number;
}

export const TIMELINE_EMPTY = 'No pilot actions recorded.';
export const TIMELINE_FOOT = 'Times are scenario time from the start of this Event Set.';

const BODY_LH = lineHeightM('body');
const YOU_PREFIX = 'YOU  ';
/** The pilot prefix is measured as it is drawn (two spaces), then the entry text wraps after it. */

/** The header text: `Timeline - <n>. <Event Set title>` (n counts from 1 in the debrief's row order). */
export function timelineTitle(n: number, eventSetTitle: string): string {
  return `Timeline - ${n}. ${eventSetTitle}`;
}

/**
 * Wrap the entries into pages of body-size lines. `measure(text, weight)` is the drawn width in metres.
 * Page 0 holds `firstPageReserveH` less than the others. The foot line is always the last line of the last page.
 */
export function layoutTimeline(entries: readonly TimelineEntry[], measure: (s: string, weight: number) => number, firstPageReserveH = 0): TimelineLayout {
  const g = timelineGeo();
  const lines: TimelineLine[] = [];
  for (const e of entries) {
    const you = e.who === 'you';
    const weight = you ? 700 : 500;
    const wrapped = wrapText(e.text, g.textW, (t) => measure(t, weight), you ? measure(YOU_PREFIX, weight) : 0);
    wrapped.forEach((text, i) => lines.push({ clock: i === 0 ? formatClock(e.tSec) : '', text: you && i === 0 ? `${YOU_PREFIX}${text}` : text, you }));
  }
  const note = (text: string) => {
    for (const t of wrapText(text, g.textW, (s) => measure(s, 500))) lines.push({ clock: '', text: t, you: false });
  };
  if (!entries.some((e) => e.who === 'you')) note(TIMELINE_EMPTY);
  note(TIMELINE_FOOT);

  const perPage = Math.max(1, Math.floor(g.area.h / BODY_LH + 1e-9));
  const reserve = Math.max(0, firstPageReserveH);
  const firstCap = Math.max(0, Math.floor((g.area.h - reserve) / BODY_LH + 1e-9));
  const pages: TimelineLine[][] = [lines.slice(0, firstCap)];
  for (let i = firstCap; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return { pages, reserveH: reserve };
}

/** Pads shown on `page`: BACK always, PREV and NEXT only when there is a page before / after. */
export function timelinePads(layout: TimelineLayout, page: number): Array<{ id: 'back' | 'prev' | 'next'; rect: Rect }> {
  const g = timelineGeo();
  const out: Array<{ id: 'back' | 'prev' | 'next'; rect: Rect }> = [{ id: 'back', rect: g.back }];
  if (page > 0) out.push({ id: 'prev', rect: g.prev });
  if (page < layout.pages.length - 1) out.push({ id: 'next', rect: g.next });
  return out;
}

export interface TimelineDrawState {
  /** The full header text, from timelineTitle. */
  title: string;
  attempt: 'first' | 'redo';
  layout: TimelineLayout;
  page: number;
  /** Electrical diagrams drawn at the top of page 0, or null/absent for none. The layout must have reserved room for them. */
  elec?: readonly ElecMoment[] | null;
  level(id: string): PadLevel;
}

export function drawTimeline(zc: ZoneCanvas, s: TimelineDrawState): void {
  const g = timelineGeo();
  drawFrame(zc);
  zc.text(s.title, g.header.titleX, g.header.cy, 'body', THEME.color.text, 'left', 700);
  if (s.attempt === 'redo') zc.text('(REDO)', g.header.titleX + zc.measure(`${s.title} `, 'body', 700), g.header.cy, 'body', THEME.color.accent, 'left', 700);
  const pages = s.layout.pages.length;
  if (pages > 1) {
    zc.text(`Page ${s.page + 1} of ${pages}`, g.pageLabelRight, g.header.cy, 'body', THEME.color.textDim, 'right', 600);
    if (s.page > 0) drawButton(zc, g.prev, 'PREV', s.level('prev'), 'neutral');
    if (s.page < pages - 1) drawButton(zc, g.next, 'NEXT', s.level('next'), 'neutral');
  }
  drawButton(zc, g.back, 'BACK', s.level('back'));
  if (s.page === 0 && s.elec) drawElecStrip(zc, g.area.top, s.elec);
  const top = g.area.top - (s.page === 0 ? s.layout.reserveH : 0);
  (s.layout.pages[s.page] ?? []).forEach((l, i) => {
    const y = top - BODY_LH * (i + 0.5);
    const color = l.you ? THEME.color.text : THEME.color.textDim;
    const weight = l.you ? 700 : 500;
    if (l.clock) zc.text(l.clock, g.timeX, y, 'body', color, 'left', weight);
    zc.text(l.text, g.textX, y, 'body', color, 'left', weight);
  });
}
