/**
 * Pure comms page layout (no DOM/three): ONE message per page. A message page is the channel tag plus the FULL message text
 * at THEME body (wrapped, never truncated) above that message's own reply cards (full width, body text, may wrap to two or
 * more lines). The RECENT page lists the last messages' text at body. Tested in tests/xr/panels.test.ts with the real scenario.
 */
import { MIN_GAP } from '../cockpit/layout';
import type { MessageEntry, PendingCard } from './panelModel';
import { lineHeightM, wrapText, type Measure } from './textLayout';

/** One-line note shown in the comms panel when a printout reaches the kneeboard (ASCII, body size). */
export const PRINTOUT_NOTE = 'New printout on kneeboard';
export const CARD_PAD_V = 0.005;
export const CARD_PAD_H = 0.008;
export const MIN_CARD_H = 0.035;
/** Space between the message text and its first card, and between messages on the RECENT page. */
export const TEXT_GAP = 0.008;
/** Gap between the channel tag and the first word of the message. */
export const TAG_GAP = 0.005;

export interface CardPlacement {
  card: PendingCard;
  lines: string[];
  cy: number;
  h: number;
}

export interface Area {
  top: number;
  h: number;
  w: number;
}

export interface MessagePageLayout {
  /** Width reserved for the channel tag at the start of the first line (tag + gap). */
  tagW: number;
  lines: string[];
  cards: CardPlacement[];
  /** Total height used measured down from the area top (metres). */
  usedH: number;
  /** True when message and cards fit the area. Never solved by truncating or shrinking text. */
  fits: boolean;
}

/** Message text (tag inline on the first line) at body, then the message's own cards. `measure` measures body text. */
export function layoutMessagePage(text: string, cards: readonly PendingCard[], measure: Measure, tagWidth: number, area: Area): MessagePageLayout {
  const lh = lineHeightM('body');
  const tagW = tagWidth + TAG_GAP;
  const lines = wrapText(text, area.w, measure, tagW);
  let y = lines.length * lh; // measured down from area.top
  const placed: CardPlacement[] = [];
  cards.forEach((card, i) => {
    y += i === 0 ? TEXT_GAP : MIN_GAP;
    const wrapped = wrapText(card.text, area.w - 2 * CARD_PAD_H, measure);
    const h = Math.max(MIN_CARD_H, wrapped.length * lh + 2 * CARD_PAD_V);
    placed.push({ card, lines: wrapped, cy: area.top - y - h / 2, h });
    y += h;
  });
  return { tagW, lines, cards: placed, usedH: y, fits: y <= area.h + 1e-9 };
}

export interface RecentItem {
  id: string;
  tag: string;
  tagW: number;
  lines: string[];
}

/**
 * The RECENT page: messages (newest first) as tag + full text at body. A message is never cut: when they do not all fit
 * they are split into parts of whole messages (the RECENT pad steps through the parts). `reservedLines` leaves room for a note.
 */
export function layoutRecent(
  messages: ReadonlyArray<Pick<MessageEntry, 'id' | 'text'> & { tag: string }>,
  measure: Measure,
  tagWidthOf: (tag: string) => number,
  area: Area,
  reservedLines = 0,
): RecentItem[][] {
  const lh = lineHeightM('body');
  const items: RecentItem[] = messages.map((m) => {
    const tagW = tagWidthOf(m.tag) + TAG_GAP;
    return { id: m.id, tag: m.tag, tagW, lines: wrapText(m.text, area.w, measure, tagW) };
  });
  const parts: RecentItem[][] = [[]];
  let used = reservedLines * lh;
  for (const it of items) {
    const h = it.lines.length * lh + (parts[parts.length - 1].length ? TEXT_GAP : 0);
    if (parts[parts.length - 1].length && used + h > area.h + 1e-9) {
      parts.push([]);
      used = 0;
    }
    used += it.lines.length * lh + (parts[parts.length - 1].length ? TEXT_GAP : 0);
    parts[parts.length - 1].push(it);
  }
  return parts;
}
