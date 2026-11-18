/**
 * Pure panel state for the pedestal and kneeboard panels (Task 10). No three / IWSDK imports: the spatial
 * panels (comms.ts, checklist.ts, route.ts, kneeboard.ts) render these models and call their press methods;
 * every press method returns the PilotAction to emit (or null when the press must do nothing).
 */
import type { PilotAction, ReplyCard, WorldCue } from '../../contracts/events';
import type { AirportDef, ChecklistDef, EventSetDef } from '../../contracts/scenario';
import { OptionLogic } from '../controls/controlLogic';
import { clampLines } from './textLayout';

type Message = Extract<WorldCue, { kind: 'message' }>;

// ---------------------------------------------------------------------------
// Comms
// ---------------------------------------------------------------------------
export interface MessageEntry {
  id: string;
  channel: Message['channel'];
  text: string;
  cards: ReplyCard[];
  answered: boolean;
}

export interface PendingCard {
  messageId: string;
  channel: Message['channel'];
  cardId: string;
  text: string;
}

/** Decision family of a reply card: its id prefix before the first '-' (dec-return -> dec, dev-left -> dev). */
export const cardFamily = (cardId: string): string => cardId.split('-')[0];

/**
 * Message log + reply cards. Cards belong to the event set that sent them: every unanswered message of the
 * CURRENT set keeps its cards (newest message first); a message's cards go once one of them is chosen (other messages lose
 * the cards they share with it, see choose), and all cards go when the next event set starts. The text of old messages stays in the log.
 */
export class CommsModel {
  /** False while the engine will not take the action (paused, debrief, grace window): presses change nothing. */
  live = true;
  private entries: MessageEntry[] = [];
  private setId: string | null = null;

  /** Returns true when something visible changed. */
  apply(cue: WorldCue): boolean {
    if (cue.kind === 'eventSet') {
      if (cue.status !== 'start') return false;
      this.setId = cue.eventSetId;
      for (const m of this.entries) m.cards = [];
      return true;
    }
    if (cue.kind !== 'message' || cue.channel === 'crew') return false;
    this.entries = this.entries.filter((m) => m.id !== cue.id);
    const cards = cue.cards ?? [];
    if (cards.length) {
      // A message that re-offers the cards the pilot has not answered yet replaces them: an older unanswered message whose
      // card-id set is a SUBSET of (or equal to) the new one retires (its cards go; its text stays in the log), so one decision
      // is never offered twice (e.g. the 120 s "say intentions" prompt). Partial overlaps (dep-climb vs atc-wx) both stay.
      const ids = new Set(cards.map((c) => c.id));
      for (const m of this.entries) if (!m.answered && m.cards.length > 0 && m.cards.every((c) => ids.has(c.id))) this.retire(m);
    }
    this.entries.push({ id: cue.id, channel: cue.channel, text: cue.text, cards: [...cards], answered: cards.length === 0 });
    // Cards are NEVER retired for space: more unanswered messages than page pads are reached by overflow paging in the view.
    return true;
  }

  private retire(m: MessageEntry): void {
    m.cards = [];
    m.answered = true;
  }

  /** Unanswered messages that still offer cards, newest first (one comms page each). */
  pendingMessages(): MessageEntry[] {
    return this.entries.filter((m) => !m.answered && m.cards.length > 0).reverse();
  }

  currentSetId(): string | null {
    return this.setId;
  }

  /** Newest first. */
  lastMessages(n: number): MessageEntry[] {
    return this.entries.slice(-n).reverse();
  }

  /** Every offered card of every unanswered message, newest message first, card order preserved. */
  pendingCards(): PendingCard[] {
    const out: PendingCard[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const m = this.entries[i];
      if (m.answered) continue;
      for (const c of m.cards) out.push({ messageId: m.id, channel: m.channel, cardId: c.id, text: c.text });
    }
    return out;
  }

  choose(messageId: string, cardId: string): PilotAction | null {
    if (!this.live) return null;
    const m = this.entries.find((e) => e.id === messageId);
    if (!m || m.answered || !m.cards.some((c) => c.id === cardId)) return null;
    const chosenSet = new Set(m.cards.map((c) => c.id));
    m.answered = true;
    m.cards = [];
    // Retire-on-choose. AUTHORING CONVENTION: reply-card ids carry a family prefix (text before the first '-', e.g. dec-*,
    // dev-*); cards in one family are mutually exclusive choices. Every OTHER unanswered message loses the cards it SHARES with
    // the chosen message's card set, plus its cards of the same family as a shared card (dec-continue goes with dec-return,
    // else "continue" would still be offered after a return/divert chosen on dsp-reoffer). Cards of another family stay
    // answerable (dep-climb keeps dep-readback after a deviation is chosen on atc-wx); a message left with no cards retires
    // (its text stays in the log). Guarded by the "reply-card family convention" test in tests/xr/panels.test.ts.
    for (const o of this.entries) {
      if (o === m || o.answered) continue;
      const families = new Set(o.cards.filter((c) => chosenSet.has(c.id)).map((c) => cardFamily(c.id)));
      if (families.size === 0) continue;
      o.cards = o.cards.filter((c) => !chosenSet.has(c.id) && !families.has(cardFamily(c.id)));
      if (o.cards.length === 0) this.retire(o);
    }
    return { kind: 'reply', messageId, cardId };
  }

  reset(): void {
    this.entries = [];
    this.setId = null;
  }
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
export class ChecklistModel {
  /** False while the engine will not take the action (paused, debrief, grace window): presses change nothing. */
  live = true;
  private readonly defs = new Map<string, ChecklistDef>();
  private currentId: string | null = null;
  private readonly ticks = new Map<string, string[]>(); // checklistId -> item ids in the order confirmed
  private readonly late = new Map<string, Set<string>>(); // checklistId -> items confirmed out of order

  constructor(defs: readonly ChecklistDef[]) {
    for (const d of defs) this.defs.set(d.id, d);
  }

  /** A different flight: its checklists replace the old ones, and nothing of the old flight (open list, ticks) remains. */
  setDefs(defs: readonly ChecklistDef[]): void {
    this.defs.clear();
    for (const d of defs) this.defs.set(d.id, d);
    this.reset();
  }

  /** Open (show) a checklist by id. False for an unknown id. */
  open(id: string): boolean {
    if (!this.defs.has(id)) return false;
    this.currentId = id;
    return true;
  }

  /** Titles of every checklist the scenario has, in order (dev read-out). */
  titles(): string[] {
    return [...this.defs.values()].map((d) => d.title);
  }

  current(): ChecklistDef | null {
    return this.currentId ? (this.defs.get(this.currentId) ?? null) : null;
  }

  isTicked(itemId: string): boolean {
    return !!this.currentId && !!this.ticks.get(this.currentId)?.includes(itemId);
  }

  /** Confirm an item. Out-of-order is allowed and recorded. Null when nothing is open, the item is unknown or already confirmed. */
  tick(itemId: string): { action: PilotAction; inOrder: boolean } | null {
    if (!this.live) return null;
    const def = this.current();
    if (!def) return null;
    const index = def.items.findIndex((i) => i.id === itemId);
    if (index < 0 || this.isTicked(itemId)) return null;
    const order = this.ticks.get(def.id) ?? [];
    const inOrder = def.items.slice(0, index).every((i) => order.includes(i.id));
    this.ticks.set(def.id, [...order, itemId]);
    if (!inOrder) this.late.set(def.id, (this.late.get(def.id) ?? new Set()).add(itemId));
    return { action: { kind: 'checklistItem', checklistId: def.id, itemId }, inOrder };
  }

  /** Undo only the displayed confirmation. No pilot action: satisfied scenario conditions stay satisfied. */
  untick(itemId: string): boolean {
    if (!this.live || !this.currentId || !this.isTicked(itemId)) return false;
    this.ticks.set(this.currentId, this.ticks.get(this.currentId)!.filter((id) => id !== itemId));
    this.late.get(this.currentId)?.delete(itemId);
    return true;
  }

  tickOrder(): string[] {
    return this.currentId ? [...(this.ticks.get(this.currentId) ?? [])] : [];
  }

  outOfOrder(): string[] {
    return this.currentId ? [...(this.late.get(this.currentId) ?? [])] : [];
  }

  reset(): void {
    this.currentId = null;
    this.ticks.clear();
    this.late.clear();
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export class RouteModel {
  /** False while the engine will not take the action (paused, debrief, grace window): presses change nothing. */
  live = true;
  private logic: OptionLogic;
  constructor(
    private airports: readonly AirportDef[],
    initial: string,
  ) {
    this.logic = new OptionLogic(
      airports.map((a) => a.id),
      initial,
    );
  }

  /** A different flight: its airports, with `initial` selected. */
  setAirports(airports: readonly AirportDef[], initial: string): void {
    this.airports = airports;
    this.logic = new OptionLogic(
      airports.map((a) => a.id),
      initial,
    );
  }

  rows(): ReadonlyArray<{ id: string; name: string }> {
    return this.airports;
  }

  selected(): string {
    return this.logic.value;
  }

  select(id: string): PilotAction | null {
    if (!this.live) return null;
    const i = this.airports.findIndex((a) => a.id === id);
    if (i < 0) return null;
    this.logic.select(i);
    return { kind: 'control', controlId: 'route.destination', value: id };
  }

  /** Display sync from AircraftState.destination. Never an action. */
  setDestination(id: string): void {
    this.logic.setValue(id);
  }
}

// ---------------------------------------------------------------------------
// Kneeboard
// ---------------------------------------------------------------------------
export interface KneeboardEntry {
  id: string;
  title: string;
  body: string;
}

export interface KneeboardPage {
  entryId: string;
  title: string;
  lines: string[];
  /** 1-based continuation number within the entry, and how many there are. */
  part: number;
  parts: number;
}

/** Split every entry into pages of at most `linesPerPage` wrapped lines (briefing first, printouts after). */
export function kneeboardPages(entries: readonly KneeboardEntry[], wrap: (text: string) => string[], linesPerPage: number): KneeboardPage[] {
  const pages: KneeboardPage[] = [];
  for (const e of entries) {
    const lines = wrap(e.body);
    const parts = Math.max(1, Math.ceil(lines.length / linesPerPage));
    for (let p = 0; p < parts; p++)
      pages.push({ entryId: e.id, title: e.title, lines: lines.slice(p * linesPerPage, (p + 1) * linesPerPage), part: p + 1, parts });
  }
  return pages;
}

export interface KneeboardRender {
  title: string;
  lines: string[];
  part: number;
  parts: number;
  pageNumber: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  hint: { visible: boolean; lines: string[]; canAsk: boolean };
}

const NO_MORE_HINTS = 'No more hints for this part.';

/**
 * Pages + hints. Only pilot-visible fields are copied out of the scenario (briefing, printouts, hints): the
 * event-set objects are never stored or rendered, so instructorNotes cannot leak.
 */
export class KneeboardModel {
  /** False while the engine will not take the action (paused, debrief, grace window): presses change nothing. */
  live = true;
  private base: KneeboardEntry[];
  private printouts: KneeboardEntry[] = [];
  private readonly hintsBySet = new Map<string, string[]>();
  private readonly hintsUsed = new Map<string, number>();
  private setId: string | null = null;
  private shown: string | null = null;
  private page = 0;
  private wrap: (text: string) => string[] = (t) => t.split('\n');
  private linesPerPage = 9;

  constructor(briefing: readonly KneeboardEntry[], eventSets: readonly Pick<EventSetDef, 'id' | 'hints'>[]) {
    this.base = briefing.map((b) => ({ id: b.id, title: b.title, body: b.body }));
    for (const es of eventSets) this.hintsBySet.set(es.id, [...es.hints]);
  }

  /** A different flight: its briefing and hints replace the old ones; printouts, shown hint and page go with them. */
  setScenario(briefing: readonly KneeboardEntry[], eventSets: readonly Pick<EventSetDef, 'id' | 'hints'>[]): void {
    this.base = briefing.map((b) => ({ id: b.id, title: b.title, body: b.body }));
    this.hintsBySet.clear();
    for (const es of eventSets) this.hintsBySet.set(es.id, [...es.hints]);
    this.reset();
  }

  /** The view sets how text wraps and how many lines fit on a page; pages are derived from this. */
  setLayout(wrap: (text: string) => string[], linesPerPage: number): void {
    this.wrap = wrap;
    this.linesPerPage = linesPerPage;
    this.page = Math.min(this.page, this.pages().length - 1);
  }

  entries(): KneeboardEntry[] {
    return [...this.base, ...this.printouts];
  }

  pages(): KneeboardPage[] {
    return kneeboardPages(this.entries(), this.wrap, this.linesPerPage);
  }

  /** Add (or replace) a printout and open its first page. */
  addPrintout(id: string, title: string, body: string): void {
    this.printouts = this.printouts.filter((p) => p.id !== id);
    this.printouts.push({ id, title, body });
    this.page = Math.max(0, this.pages().findIndex((p) => p.entryId === id));
  }

  onEventSet(id: string): void {
    this.setId = id;
    this.shown = null;
  }

  /** Flat index into pages(). */
  pageIndex(): number {
    return this.page;
  }

  next(): void {
    this.page = Math.min(this.pages().length - 1, this.page + 1);
  }

  prev(): void {
    this.page = Math.max(0, this.page - 1);
  }

  /** One press of "Need a hint?": the action to emit (once) and the hint it reveals. Null when there is nothing to ask. */
  pressHint(): PilotAction | null {
    if (!this.live) return null;
    if (!this.setId) return null;
    const hints = this.hintsBySet.get(this.setId) ?? [];
    const used = this.hintsUsed.get(this.setId) ?? 0;
    if (used >= hints.length) {
      this.shown = NO_MORE_HINTS;
      return null;
    }
    this.hintsUsed.set(this.setId, used + 1);
    this.shown = hints[used];
    return { kind: 'hint', eventSetId: this.setId };
  }

  hintText(): string | null {
    return this.shown;
  }

  hintAvailable(): boolean {
    return !!this.setId;
  }

  currentSetId(): string | null {
    return this.setId;
  }

  /** Everything the view draws. Plain data with no scenario objects inside. */
  renderModel(hintLines = 4): KneeboardRender {
    const pages = this.pages();
    const p = pages[Math.min(this.page, pages.length - 1)];
    return {
      title: p?.title ?? '',
      lines: p ? [...p.lines] : [],
      part: p?.part ?? 1,
      parts: p?.parts ?? 1,
      pageNumber: this.page + 1,
      pageCount: pages.length,
      canPrev: this.page > 0,
      canNext: this.page < pages.length - 1,
      hint: {
        visible: this.shown !== null,
        lines: this.shown ? clampLines(this.wrap(this.shown), hintLines) : [],
        canAsk: this.hintAvailable(),
      },
    };
  }

  reset(): void {
    this.printouts = [];
    this.hintsUsed.clear();
    this.setId = null;
    this.shown = null;
    this.page = 0;
  }
}
