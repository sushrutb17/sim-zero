/**
 * Comms panel. ONE message per page: the page shows the message's channel tag and FULL text at THEME body (never truncated)
 * above ITS OWN reply cards. Pages are the unanswered messages of the current event set (newest first, opened automatically
 * when a message arrives) plus a final RECENT page with the last three messages' text. The page pads (top row, right) are
 * labelled by channel; the PA button is at the left of that row. A one-line note says when a printout arrived on the kneeboard.
 * One canvas quad; all buttons are invisible hit pads (panelPad.ts).
 */
import type { Entity, Vector3, World } from '@iwsdk/core';
import type { EventBus } from '../../bus/eventBus';
import type { WorldCue } from '../../contracts/events';
import { THEME } from '../theme';
import { COMMS_CARDS_PER_PAGE_MAX, COMMS_MESSAGE_PAGES_MAX, COMMS_PAGES_MAX, MIN_GAP, commsGeo } from '../cockpit/layout';
import { CommsModel, type MessageEntry, type PendingCard } from './panelModel';
import { ZoneCanvas, lineHeightM } from './draw';
import { CARD_PAD_H, PRINTOUT_NOTE, layoutMessagePage, layoutRecent, TEXT_GAP, type MessagePageLayout, type RecentItem } from './cardLayout';
import { createPanelPad, type PanelPad } from './panelPad';
import { PressDebouncer } from '../controls/controlLogic';
import type { PanelView } from './view';

const FREEZE_MS = 500;
const DEFER_MS = 600;
const RECENT_COUNT = 3;
const NOTE_MS = 20000;
const TAG: Record<string, string> = { atc: 'ATC', cabin: 'CABIN', dispatch: 'DISPATCH', ground: 'GROUND', crew: 'F/O' };
const tagOf = (channel: string): string => TAG[channel] ?? channel.toUpperCase();

interface Page {
  key: string; // message id, or 'recent'
  label: string;
  msg?: MessageEntry;
  layout?: MessagePageLayout;
  parts?: RecentItem[][];
}

export interface CommsView extends PanelView {
  apply(cue: WorldCue): void;
  setFreq(f: string): void;
  /** A printout arrived on the kneeboard: show the one-line note for a while. */
  notePrintout(): void;
  model: CommsModel;
  pageCount(): number;
  /** Index of the page being shown (0 = newest message, last = RECENT). */
  currentPage(): number;
  /** Page keys in pad order (message ids newest first, then 'recent'). */
  pageKeys(): string[];
  /** Which page and slot a pending card is on (undefined when it is not pending). */
  placementOf(cardId: string, messageId?: string): { page: number; slot: number } | undefined;
  /** Mesh name of the pad that opens page `page` (the MORE pad when the page is outside the pad window); undefined when there is no pad. */
  pagePadName(page: number): string | undefined;
}

export function createComms(world: World, bus: EventBus, zone: Entity, panelZ: number): CommsView {
  const g = commsGeo();
  const model = new CommsModel();
  const zc = new ZoneCanvas(g.W, g.H);
  zc.panel.mesh.name = 'panel:comms';
  zc.panel.mesh.position.z = panelZ;
  zone.object3D!.add(zc.panel.mesh);

  const lh = lineHeightM('body');
  const area = { top: g.content.top, h: g.content.h, w: g.content.w };
  const left = g.content.cx - g.content.w / 2;
  let freq = '';
  let pages: Page[] = [{ key: 'recent', label: 'RECENT' }];
  /** First message page shown on the pads when there are more message pages than pads (overflow paging). */
  let winStart = 0;
  let currentKey = 'recent';
  let recentPart = 0;
  let jumpKey: string | null = null;
  let unseen = false;
  let noteUntil = 0;
  let relayoutPending = true;
  let deferDeadline = 0;
  let frozenUntil = 0;
  let chosen: { messageId: string; cardId: string } | null = null;
  let sig = '';

  const cardPads: PanelPad[] = [];
  for (let i = 0; i < COMMS_CARDS_PER_PAGE_MAX; i++) cardPads.push(createPanelPad(world, zone, `comms.card.${i}`, () => pressCard(i)));
  const dotPads: PanelPad[] = [];
  for (let i = 0; i < COMMS_PAGES_MAX; i++) dotPads.push(createPanelPad(world, zone, `comms.page.${i}`, () => pressPage(i)));
  const paPad = createPanelPad(world, zone, 'pa.cabin', () => {
    if (model.live) bus.emitAction({ kind: 'control', controlId: 'pa.cabin', value: true });
  }, new PressDebouncer());
  paPad.rect(g.pa.cx, g.pa.cy, g.pa.w, g.pa.h);

  const dotIndexForPage = (k: number, n: number) => n - 1 - k; // RECENT (the last page) is the rightmost pad
  const pageIndex = () => Math.max(0, pages.findIndex((p) => p.key === currentKey));
  const curPage = () => pages[pageIndex()];
  /** The pad list: message pages (all when they fit, else a window of COMMS_MESSAGE_PAGES_MAX - 1 plus a MORE pad), then RECENT. */
  function padList(): Page[] {
    const msgs = pages.filter((p) => p.key !== 'recent');
    const recent = pages[pages.length - 1];
    if (msgs.length <= COMMS_MESSAGE_PAGES_MAX) return [...msgs, recent];
    const span = COMMS_MESSAGE_PAGES_MAX - 1;
    winStart = Math.min(Math.max(0, winStart), msgs.length - 1);
    return [...msgs.slice(winStart, winStart + span), { key: 'more', label: 'MORE' }, recent];
  }
  /** Scroll the overflow window so page `key` has a pad. */
  function showInWindow(key: string): void {
    const msgs = pages.filter((p) => p.key !== 'recent');
    const i = msgs.findIndex((p) => p.key === key);
    const span = COMMS_MESSAGE_PAGES_MAX - 1;
    if (msgs.length > COMMS_MESSAGE_PAGES_MAX && i >= 0 && (i < winStart || i >= winStart + span)) winStart = Math.floor(i / span) * span;
  }
  const noteActive = () => performance.now() < noteUntil;

  function pressCard(slot: number): void {
    const placed = curPage().layout?.cards[slot];
    if (!placed) return;
    const action = model.choose(placed.card.messageId, placed.card.cardId);
    if (!action) return;
    bus.emitAction(action);
    chosen = { messageId: placed.card.messageId, cardId: placed.card.cardId };
    frozenUntil = performance.now() + FREEZE_MS;
    relayoutPending = true;
    zc.panel.markDirty();
  }

  function pressPage(dotIdx: number): void {
    const list = padList();
    const n = list.length;
    const k = n - 1 - dotIdx;
    if (k < 0 || k >= n) return;
    const p = list[k];
    if (p.key === 'more') {
      const msgs = pages.filter((q) => q.key !== 'recent');
      const span = COMMS_MESSAGE_PAGES_MAX - 1;
      winStart = winStart + span >= msgs.length ? 0 : winStart + span;
      currentKey = msgs[winStart].key;
      recentPart = 0;
      placePads();
      zc.panel.markDirty();
      return;
    }
    if (p.key === 'recent' && currentKey === 'recent') recentPart = (recentPart + 1) % Math.max(1, p.parts?.length ?? 1);
    else recentPart = 0;
    currentKey = p.key;
    if (p.key === 'recent') unseen = false;
    placePads();
    zc.panel.markDirty();
  }

  function placePads(): void {
    const cards = curPage().layout?.cards ?? [];
    cardPads.forEach((p, i) => {
      const c = cards[i];
      if (c) p.rect(g.content.cx, c.cy, g.content.w, c.h);
      else p.hide();
    });
    const n = padList().length;
    dotPads.forEach((p, i) => {
      if (n > 1 && i < n) p.rect(g.dots[i].cx, g.dots[i].cy, g.dots[i].w, g.dots[i].h);
      else p.hide();
    });
  }

  const bodyMeasure = zc.measurer('body', 500);
  const tagWidth = (tag: string) => zc.measure(tag, 'body', 700);

  function relayout(): void {
    const pend = model.pendingMessages();
    const next: Page[] = pend.map((m) => ({
      key: m.id,
      label: tagOf(m.channel),
      msg: m,
      layout: layoutMessagePage(
        m.text,
        m.cards.map((c): PendingCard => ({ messageId: m.id, channel: m.channel, cardId: c.id, text: c.text })),
        bodyMeasure,
        tagWidth(tagOf(m.channel)),
        area,
      ),
    }));
    const recent = model.lastMessages(RECENT_COUNT).map((m) => ({ id: m.id, text: m.text, tag: tagOf(m.channel) }));
    next.push({ key: 'recent', label: 'RECENT', parts: layoutRecent(recent, bodyMeasure, tagWidth, area, 1) });
    pages = next;
    if (jumpKey && pages.some((p) => p.key === jumpKey)) {
      currentKey = jumpKey;
      if (jumpKey === 'recent') unseen = false;
    } else if (!pages.some((p) => p.key === currentKey)) {
      currentKey = pages[0].key; // newest unanswered message, else RECENT
    }
    showInWindow(currentKey);
    jumpKey = null;
    recentPart = Math.min(recentPart, Math.max(0, (pages[pages.length - 1].parts?.length ?? 1) - 1));
    relayoutPending = false;
    placePads();
    zc.panel.markDirty();
  }

  function cardFill(pad: PanelPad, isChosen: boolean): { fill: string; stroke?: { color: string; width: number } } {
    if (isChosen || pad.press() > 0.5) return { fill: THEME.color.pressedFill, stroke: { color: THEME.color.accent, width: 0.002 } };
    if (pad.hover() > 0.5) return { fill: THEME.color.hoverFill, stroke: { color: THEME.color.accent, width: 0.002 } };
    return { fill: THEME.color.panelEdge };
  }

  /** Free width in the top row between the PA button and the leftmost visible page pad. */
  function rowFree(): { x0: number; w: number } {
    const n = padList().length > 1 ? padList().length : 0;
    const x0 = g.pa.cx + g.pa.w / 2 + MIN_GAP;
    const x1 = n > 0 ? g.dots[n - 1].cx - g.dots[n - 1].w / 2 - MIN_GAP : g.W / 2 - 0.01;
    return { x0, w: x1 - x0 };
  }

  function draw(): void {
    zc.clear();
    drawButton(paPad, g.pa.cx, g.pa.cy, g.pa.w, g.pa.h, 'PA');
    drawDots();
    // top-row text: the printout note when active, else the COM1 frequency, when it fits beside the pads
    const free = rowFree();
    const text = noteActive() ? PRINTOUT_NOTE : freq ? `COM1 ${freq}` : '';
    if (text && zc.measure(text, 'body', 500) <= free.w) zc.text(text, free.x0, g.row.cy, 'body', noteActive() ? THEME.color.accent : THEME.color.textDim, 'left', 500);
    const page = curPage();
    if (page.layout && page.msg) drawMessagePage(page);
    else drawRecent(page);
  }

  function drawMessagePage(page: Page): void {
    const lay = page.layout!;
    const msg = page.msg!;
    const tag = tagOf(msg.channel);
    zc.text(tag, left, area.top - lh / 2, 'body', THEME.alert.advisory, 'left', 700);
    lay.lines.forEach((l, j) => zc.text(l, j === 0 ? left + lay.tagW : left, area.top - lh * (j + 0.5), 'body', THEME.color.text, 'left', 500));
    lay.cards.forEach((c, i) => {
      const isChosen = !!chosen && chosen.messageId === c.card.messageId && chosen.cardId === c.card.cardId;
      const { fill, stroke } = cardFill(cardPads[i], isChosen);
      zc.box(g.content.cx, c.cy, g.content.w, c.h, fill, stroke);
      zc.lines(c.lines, left + CARD_PAD_H, c.cy + (c.lines.length * lh) / 2, 'body', THEME.color.text, 'left', 500);
    });
  }

  function drawRecent(page: Page): void {
    const parts = page.parts ?? [[]];
    const items = parts[Math.min(recentPart, parts.length - 1)] ?? [];
    let y = area.top;
    // line 1: the note (when the top row had no room) or the part indicator
    const row = rowFree();
    const noteInRow = noteActive() && zc.measure(PRINTOUT_NOTE, 'body', 500) <= row.w;
    const head = noteActive() && !noteInRow ? PRINTOUT_NOTE : parts.length > 1 ? `Part ${Math.min(recentPart, parts.length - 1) + 1} of ${parts.length} - tap RECENT for more` : '';
    if (head) zc.text(head, left, y - lh / 2, 'body', noteActive() && !noteInRow ? THEME.color.accent : THEME.color.textDim, 'left', 500);
    y -= lh;
    if (items.length === 0) {
      zc.text('No messages yet', left, y - lh / 2 - TEXT_GAP, 'body', THEME.color.textDim, 'left', 500);
      return;
    }
    items.forEach((it, i) => {
      if (i > 0) y -= TEXT_GAP;
      zc.text(it.tag, left, y - lh / 2, 'body', THEME.alert.advisory, 'left', 700);
      it.lines.forEach((l, j) => zc.text(l, j === 0 ? left + it.tagW : left, y - lh * (j + 0.5), 'body', i === 0 ? THEME.color.text : THEME.color.textDim, 'left', 500));
      y -= it.lines.length * lh;
    });
  }

  function drawDots(): void {
    const list = padList();
    const n = list.length;
    if (n <= 1) return;
    for (let k = 0; k < n; k++) {
      const d = g.dots[dotIndexForPage(k, n)];
      const pad = dotPads[dotIndexForPage(k, n)];
      const active = list[k].key === currentKey;
      const alert = list[k].key === 'recent' && (unseen || noteActive()) && !active;
      const fill = active ? THEME.color.accent : pad.press() > 0.5 ? THEME.color.pressedFill : pad.hover() > 0.5 ? THEME.color.hoverFill : THEME.color.panelEdge;
      zc.box(d.cx, d.cy, d.w, d.h, fill, alert ? { color: THEME.color.accent, width: 0.003 } : undefined);
      zc.text(list[k].label, d.cx, d.cy, 'body', active ? THEME.color.bezel : THEME.color.text, 'center', 700);
    }
  }

  function drawButton(pad: PanelPad, cx: number, cy: number, w: number, h: number, label: string): void {
    const { fill, stroke } = cardFill(pad, false);
    zc.box(cx, cy, w, h, fill, stroke);
    zc.text(label, cx, cy, 'body', THEME.color.text, 'center', 700);
  }

  zc.panel.setDraw(draw);
  placePads();

  const padSignature = (): string => {
    let s = noteActive() ? 'n' : '_';
    for (const p of [...cardPads, ...dotPads, paPad]) s += p.hover() > 0.5 ? 'h' : p.press() > 0.5 ? 'p' : '-';
    return s;
  };

  return {
    model,
    pageCount: () => pages.length,
    currentPage: pageIndex,
    pageKeys: () => pages.map((p) => p.key),
    apply(cue) {
      if (!model.apply(cue)) return;
      if (cue.kind === 'message') {
        if (cue.cards?.length) jumpKey = cue.id; // a message with cards opens its own page
        else {
          unseen = true; // text-only: shown on RECENT; the pad is marked until it is opened
          if (model.pendingMessages().length === 0) jumpKey = 'recent';
        }
      }
      if (!relayoutPending) deferDeadline = performance.now() + DEFER_MS;
      relayoutPending = true;
      zc.panel.markDirty();
    },
    setFreq(f) {
      if (f === freq) return;
      freq = f;
      zc.panel.markDirty();
    },
    notePrintout() {
      noteUntil = performance.now() + NOTE_MS;
      unseen = true;
      zc.panel.markDirty();
    },
    tick(nowMs) {
      if (chosen && nowMs >= frozenUntil) {
        chosen = null;
        relayoutPending = true;
      }
      if (relayoutPending && nowMs >= frozenUntil) {
        const hoveringCard = cardPads.some((p) => p.hover() > 0.3);
        if (!(hoveringCard && nowMs < deferDeadline)) relayout();
      }
      if (noteUntil && !noteActive()) {
        noteUntil = 0;
        zc.panel.markDirty();
      }
      const s = padSignature();
      if (s !== sig) {
        sig = s;
        zc.panel.markDirty();
      }
      zc.panel.tick(nowMs);
    },
    reset() {
      model.reset();
      pages = [{ key: 'recent', label: 'RECENT' }];
      winStart = 0;
      currentKey = 'recent';
      recentPart = 0;
      jumpKey = null;
      unseen = false;
      noteUntil = 0;
      chosen = null;
      frozenUntil = 0;
      relayoutPending = true;
      zc.panel.markDirty();
    },
    targets() {
      const t: Record<string, () => Vector3 | undefined> = { pa: () => paPad.front() };
      // `card:<cardId>` (current page) and the unambiguous `card:<messageId>/<cardId>`
      (curPage().layout?.cards ?? []).forEach((c, slot) => {
        const front = () => cardPads[slot]?.front();
        t[`card:${c.card.messageId}/${c.card.cardId}`] = front;
        t[`card:${c.card.cardId}`] ??= front;
      });
      const list = padList();
      const n = list.length;
      list.forEach((p, k) => {
        const front = () => (n > 1 ? dotPads[dotIndexForPage(k, n)].front() : undefined);
        t[`page:${p.key}`] = front;
        if (p.key !== 'more') t[`page:${k + 1}`] = front;
      });
      return t;
    },
    pagePadName(page) {
      const list = padList();
      const n = list.length;
      if (n <= 1 || page < 0 || page >= pages.length) return undefined;
      let k = list.findIndex((p) => p.key === pages[page].key);
      if (k < 0) k = list.findIndex((p) => p.key === 'more');
      return k < 0 ? undefined : `pad:comms.page.${dotIndexForPage(k, n)}`;
    },
    placementOf(cardId, messageId) {
      for (let pi = 0; pi < pages.length; pi++) {
        const slot = pages[pi].layout?.cards.findIndex((c) => c.card.cardId === cardId && (messageId === undefined || c.card.messageId === messageId)) ?? -1;
        if (slot >= 0) return { page: pi, slot };
      }
      return undefined;
    },
  };
}
