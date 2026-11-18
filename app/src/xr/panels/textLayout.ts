/** Pure text/page layout helpers for the panels (no DOM, no three) so vitest can check them in node. */

import { THEME, fontSizeForCap } from '../theme';

export type Measure = (s: string) => number;

/** Line pitch as a multiple of the font em. */
export const LINE_EM = 1.22;
/** Line height (metres) of a text role: font size for the role's cap height x LINE_EM. */
export const lineHeightM = (role: keyof typeof THEME.text.capM): number => fontSizeForCap(THEME.text.capM[role]) * LINE_EM;

/** Word-wrap `text` to `maxWidth` using `measure`. Keeps explicit newlines; hard-breaks words that are too long. */
export function wrapText(text: string, maxWidth: number, measure: Measure, firstLineIndent = 0): string[] {
  const out: string[] = [];
  const limit = () => (out.length === 0 ? maxWidth - firstLineIndent : maxWidth);
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (word === '' && line === '') continue;
      const trial = line ? `${line} ${word}` : word;
      if (measure(trial) <= limit()) {
        line = trial;
        continue;
      }
      if (line) out.push(line);
      line = '';
      let rest = word;
      while (rest && measure(rest) > limit()) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > limit()) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** Keep at most `maxLines` lines; the last kept line ends with "..." when something was cut. */
export function clampLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = `${kept[kept.length - 1].replace(/\s+\S*$/, '')}...`;
  return kept;
}

export interface PackedCard {
  /** Index into the input list. */
  index: number;
  /** Top of the card measured down from the top of the area (metres). */
  y: number;
  h: number;
}

/**
 * Greedy page packing of variable-height cards into an area `areaH` tall with `gap` between cards.
 * A card taller than the area still gets a page of its own. Always at least one (possibly empty) page.
 */
export function packCards(heights: readonly number[], areaH: number, gap: number): PackedCard[][] {
  const pages: PackedCard[][] = [[]];
  let y = 0;
  heights.forEach((h, index) => {
    const page = pages[pages.length - 1];
    if (page.length > 0 && y + h > areaH + 1e-9) {
      pages.push([]);
      y = 0;
    }
    pages[pages.length - 1].push({ index, y, h });
    y += h + gap;
  });
  return pages;
}

/** Like packCards, but a page also holds at most `maxPerPage` entries (checklist rows). */
export function checklistPages(heights: readonly number[], areaH: number, gap: number, maxPerPage: number): PackedCard[][] {
  const pages: PackedCard[][] = [[]];
  let y = 0;
  heights.forEach((h, index) => {
    const page = pages[pages.length - 1];
    if (page.length > 0 && (page.length >= maxPerPage || y + h > areaH + 1e-9)) {
      pages.push([]);
      y = 0;
    }
    pages[pages.length - 1].push({ index, y, h });
    y += h + gap;
  });
  return pages;
}
