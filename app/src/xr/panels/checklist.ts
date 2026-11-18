/**
 * Electronic checklist: a checklistAvailable cue opens the checklist (title + items from the scenario). Items are full-width
 * rows in ONE column, three per page at most (text at THEME body, wrapped to two or three lines); PREV/NEXT pads page through
 * longer lists. Poking an empty row confirms it and emits {kind:'checklistItem'}; poking a ticked row clears it without an action.
 * Items may be confirmed in any order; the order is
 * recorded in ChecklistModel (tickOrder / outOfOrder). One canvas quad, invisible hit pads.
 */
import type { Entity, Vector3, World } from '@iwsdk/core';
import type { EventBus } from '../../bus/eventBus';
import type { ChecklistDef } from '../../contracts/scenario';
import { THEME } from '../theme';
import { CHECK_ITEMS_PER_PAGE, MIN_GAP, checklistGeo } from '../cockpit/layout';
import { ChecklistModel } from './panelModel';
import { PX_PER_M } from '../displays/drawUtil';
import { ZoneCanvas } from './draw';
import { checklistPages, wrapText, lineHeightM } from './textLayout';
import { createPanelPad, type PanelPad } from './panelPad';
import type { PanelView } from './view';

const BOX = 0.02;
const PAD_H = 0.008;
const TEXT_PAD_V = 0.005;

export interface ChecklistView extends PanelView {
  open(checklistId: string): void;
  /** A different flight (T41): its checklists replace the old ones and nothing of the old flight stays open or ticked. */
  setDefs(defs: readonly ChecklistDef[]): void;
  model: ChecklistModel;
  pageIndex(): number;
  /** Page and slot of an item of the open checklist (undefined when it is not in it). */
  rowOf(itemId: string): { page: number; slot: number } | undefined;
}

export function createChecklist(world: World, bus: EventBus, zone: Entity, panelZ: number, defs: readonly ChecklistDef[]): ChecklistView {
  const g = checklistGeo();
  const model = new ChecklistModel(defs);
  if (import.meta.env.MODE !== 'production') {
    const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
    g.__trainer = { ...g.__trainer, checklistItemTicked: (itemId: string) => model.isTicked(itemId) };
  }
  const zc = new ZoneCanvas(g.W, g.H);
  zc.panel.mesh.name = 'panel:checklist';
  zc.panel.mesh.position.z = panelZ;
  zone.object3D!.add(zc.panel.mesh);
  const lh = lineHeightM('body');
  const contentTop = g.rows[0].cy + g.rows[0].h / 2;
  const contentH = contentTop - (-g.H / 2 + 0.008);
  const textW = g.rowW - 2 * PAD_H - BOX - 0.006;
  let sig = '';
  let page = 0;

  const pads: PanelPad[] = [];
  for (let i = 0; i < CHECK_ITEMS_PER_PAGE; i++) pads.push(createPanelPad(world, zone, `check.row.${i}`, () => press(i)));
  const prevPad = createPanelPad(world, zone, 'check.prev', () => step(-1));
  const nextPad = createPanelPad(world, zone, 'check.next', () => step(1));

  interface Row {
    index: number;
    lines: string[];
    cy: number;
    h: number;
  }
  let rows: Row[][] = [[]];

  /** Wrap the items at body and pack them into pages of whole rows (<= CHECK_ITEMS_PER_PAGE, each page within the panel). */
  function relayout(): void {
    const items = model.current()?.items ?? [];
    const measure = zc.measurer('body', 500);
    const wrapped = items.map((it) => wrapText(it.text, textW, measure));
    const heights = wrapped.map((l) => Math.max(g.rowH, l.length * lh + 2 * TEXT_PAD_V));
    rows = checklistPages(heights, contentH, MIN_GAP, CHECK_ITEMS_PER_PAGE).map((pg) =>
      pg.map((p) => ({ index: p.index, lines: wrapped[p.index], cy: contentTop - p.y - p.h / 2, h: p.h })),
    );
    page = Math.min(page, rows.length - 1);
  }

  function step(d: number): void {
    const n = Math.max(0, Math.min(rows.length - 1, page + d));
    if (n === page) return;
    page = n;
    place();
    zc.panel.markDirty();
  }

  function press(slot: number): void {
    const r = rows[page]?.[slot];
    const item = r ? model.current()?.items[r.index] : undefined;
    if (!item) return;
    if (model.isTicked(item.id)) {
      if (model.untick(item.id)) zc.panel.markDirty();
      return;
    }
    const res = model.tick(item.id);
    if (!res) return;
    bus.emitAction(res.action);
    zc.panel.markDirty();
  }

  function place(): void {
    pads.forEach((p, i) => {
      const r = rows[page]?.[i];
      if (r) p.rect(0, r.cy, g.rowW, r.h);
      else p.hide();
    });
    if (rows.length > 1) {
      prevPad.rect(g.prev.cx, g.prev.cy, g.prev.w, g.prev.h);
      nextPad.rect(g.next.cx, g.next.cy, g.next.w, g.next.h);
    } else {
      prevPad.hide();
      nextPad.hide();
    }
  }

  function arrow(pad: PanelPad, r: { cx: number; cy: number; w: number; h: number }, label: string, disabled: boolean): void {
    const fill = disabled ? THEME.color.panel : pad.press() > 0.5 ? THEME.color.pressedFill : pad.hover() > 0.5 ? THEME.color.hoverFill : THEME.color.panelEdge;
    zc.box(r.cx, r.cy, r.w, r.h, fill, disabled ? { color: THEME.color.panelEdge, width: 0.0015 } : pad.hover() > 0.5 ? { color: THEME.color.accent, width: 0.002 } : undefined);
    zc.text(label, r.cx, r.cy, 'body', disabled ? THEME.color.textDim : THEME.color.text, 'center', 700);
  }

  function draw(): void {
    zc.clear();
    const cur = model.current();
    if (!cur) {
      zc.text('CHECKLIST', g.header.left, g.header.cy, 'body', THEME.color.text, 'left', 700);
      zc.lines(wrapText('No checklist open. It appears here when the situation calls for one.', g.rowW, zc.measurer('body', 500)), g.header.left, contentTop, 'body', THEME.color.textDim, 'left', 500);
      return;
    }
    const done = cur.items.filter((it) => model.isTicked(it.id)).length;
    const paged = rows.length > 1;
    const room = (paged ? g.prev.cx - g.prev.w / 2 : g.W / 2 - 0.01) - MIN_GAP - g.header.left;
    // title with the progress count; the count drops out when the title leaves no room for it
    const withCount = `${cur.title}  ${done}/${cur.items.length}`;
    zc.text(zc.measure(withCount, 'body', 700) <= room ? withCount : cur.title, g.header.left, g.header.cy, 'body', done === cur.items.length ? THEME.display.normal : THEME.color.text, 'left', 700);
    if (paged) {
      arrow(prevPad, g.prev, '<', page === 0);
      arrow(nextPad, g.next, '>', page === rows.length - 1);
    }
    (rows[page] ?? []).forEach((r, slot) => {
      const item = cur.items[r.index];
      const ticked = model.isTicked(item.id);
      const pad = pads[slot];
      const fill = pad.press() > 0.5 ? THEME.color.pressedFill : pad.hover() > 0.5 ? THEME.color.hoverFill : ticked ? THEME.color.bezel : THEME.color.panelEdge;
      zc.box(0, r.cy, g.rowW, r.h, fill, pad.hover() > 0.5 ? { color: THEME.color.accent, width: 0.002 } : undefined);
      const bx = -g.rowW / 2 + PAD_H + BOX / 2;
      zc.box(bx, r.cy, BOX, BOX, ticked ? THEME.display.normal : null, ticked ? undefined : { color: THEME.color.textDim, width: 0.0015 }, 0.003);
      if (ticked) {
        const c = zc.ctx;
        c.strokeStyle = THEME.display.bg;
        c.lineWidth = 0.0025 * PX_PER_M;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(zc.px(bx - 0.0065), zc.py(r.cy));
        c.lineTo(zc.px(bx - 0.0015), zc.py(r.cy - 0.0055));
        c.lineTo(zc.px(bx + 0.007), zc.py(r.cy + 0.006));
        c.stroke();
      }
      const tx = bx + BOX / 2 + 0.006;
      zc.lines(r.lines, tx, r.cy + (r.lines.length * lh) / 2, 'body', ticked ? THEME.color.textDim : THEME.color.text, 'left', 500);
    });
  }
  zc.panel.setDraw(draw);
  relayout();
  place();

  return {
    model,
    pageIndex: () => page,
    rowOf(itemId) {
      const index = model.current()?.items.findIndex((it) => it.id === itemId) ?? -1;
      if (index < 0) return undefined;
      for (let pg = 0; pg < rows.length; pg++) {
        const slot = rows[pg].findIndex((r) => r.index === index);
        if (slot >= 0) return { page: pg, slot };
      }
      return undefined;
    },
    setDefs(list) {
      model.setDefs(list);
      page = 0;
      relayout();
      place();
      zc.panel.markDirty();
    },
    open(id) {
      if (!model.open(id)) return;
      page = 0;
      relayout();
      place();
      zc.panel.markDirty();
    },
    tick(nowMs) {
      let s = '';
      for (const p of [...pads, prevPad, nextPad]) s += p.hover() > 0.5 ? 'h' : p.press() > 0.5 ? 'p' : '-';
      if (s !== sig) {
        sig = s;
        zc.panel.markDirty();
      }
      zc.panel.tick(nowMs);
    },
    reset() {
      model.reset();
      page = 0;
      relayout();
      place();
      zc.panel.markDirty();
    },
    targets() {
      const t: Record<string, () => Vector3 | undefined> = {};
      const cur = model.current();
      (rows[page] ?? []).forEach((r, slot) => {
        const item = cur?.items[r.index];
        if (cur && item) t[`check:${cur.id}:${item.id}`] = () => pads[slot].front();
      });
      t['check:next'] = () => nextPad.front();
      t['check:prev'] = () => prevPad.front();
      return t;
    },
  };
}
