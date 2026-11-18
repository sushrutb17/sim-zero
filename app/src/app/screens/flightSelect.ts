/**
 * Flight picker (T41): "Choose a flight" and one card per registered flight, up to three side by side. A card shows the
 * flight's title, its one-line blurb and "about N min". Poking a card (ui:flight:<id>) chooses the flight; the mode
 * screen follows. Only shown when more than one flight is registered.
 */
import type { FlightDef } from '../../scenarios/registry';
import { THEME } from '../../xr/theme';
import { lineHeightM, wrapText } from '../../xr/panels/textLayout';
import type { ZoneCanvas } from '../../xr/panels/draw';
import { MAX_FLIGHT_CARDS, SCREEN_MARGIN, flightCardRects, type Rect } from './layout';
import { drawFrame, drawTitle, type PadLevel, type SmallScreen } from './ui';

export const FLIGHT_SELECT_TITLE = 'Choose a flight';
/** Inner margin of a card, left and right. */
export const FLIGHT_CARD_PAD = 0.008;
/** The length line of a card. */
export const flightMinutes = (f: Pick<FlightDef, 'minutes'>): string => `about ${f.minutes} min`;
/** At most this many blurb lines are drawn (a longer blurb is cut, which a test forbids for the registered flights). */
export const FLIGHT_BLURB_LINES = 3;

export const flightSelectScreen: SmallScreen = {
  buttons: Array.from({ length: MAX_FLIGHT_CARDS }, (_, i) => `flight${i}`),
  pads(ctx) {
    const shown = ctx.flights.slice(0, MAX_FLIGHT_CARDS);
    const rects = flightCardRects(shown.length);
    return shown.map((_, i) => ({ id: `flight${i}`, rect: rects[i] }));
  },
  draw(zc, ctx) {
    drawFrame(zc);
    drawTitle(zc, FLIGHT_SELECT_TITLE, SCREEN_MARGIN);
    const shown = ctx.flights.slice(0, MAX_FLIGHT_CARDS);
    const rects = flightCardRects(shown.length);
    shown.forEach((f, i) => drawCard(zc, rects[i], f, ctx.level(`flight${i}`)));
  },
};

function drawCard(zc: ZoneCanvas, r: Rect, f: FlightDef, level: PadLevel): void {
  const fill = level === 'press' ? THEME.color.pressedFill : level === 'hover' ? THEME.color.hoverFill : THEME.color.panelEdge;
  zc.box(r.cx, r.cy, r.w, r.h, fill, { color: level === 'idle' ? THEME.color.textDim : THEME.color.accent, width: 0.002 }, 0.006);
  const lh = lineHeightM('body');
  const left = r.cx - r.w / 2 + FLIGHT_CARD_PAD;
  let y = r.cy + r.h / 2 - FLIGHT_CARD_PAD;
  zc.text(f.title, left, y - lh / 2, 'body', THEME.color.text, 'left', 700);
  y -= lh + 0.003;
  const lines = wrapText(f.blurb, r.w - 2 * FLIGHT_CARD_PAD, zc.measurer('body', 500)).slice(0, FLIGHT_BLURB_LINES);
  lines.forEach((l, k) => zc.text(l, left, y - lh * (k + 0.5), 'body', THEME.color.textDim, 'left', 500));
  zc.text(flightMinutes(f), left, r.cy - r.h / 2 + FLIGHT_CARD_PAD + lh / 2, 'body', THEME.color.accent, 'left', 700);
}
