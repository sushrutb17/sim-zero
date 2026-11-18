/**
 * Mode select (Task 11). GUIDED FLIGHT (trainer shows each step) and PRACTISE ALONE. Manual mode ("Join instructor") was cut for this competition
 * (2026-11-09), so that option is not shown; the reducer keeps its `chooseManual` event (a product decision for the user).
 */
import { THEME } from '../../xr/theme';
import { AUTO_SOLO, SCREEN_MARGIN, SMALL_BUTTONS } from './layout';
import { drawButton, drawFrame, drawParagraph, drawTitle, type SmallScreen } from './ui';

/** What the mode screen says under its title: for a flight with no guide steps, why GUIDED FLIGHT is missing. */
export const modeHint = (flight: { title: string; guided: boolean }): string =>
  flight.guided ? 'First time here? Choose GUIDED FLIGHT.' : `${flight.title} has no guided flight. You fly it on your own.`;

export const modeSelectScreen: SmallScreen = {
  buttons: ['guided', 'auto'],
  /** A flight without guide steps (T41) offers PRACTISE ALONE only, centred. */
  pads: (ctx) => (ctx.flight.guided ? [{ id: 'guided', rect: SMALL_BUTTONS.guided }, { id: 'auto', rect: SMALL_BUTTONS.auto }] : [{ id: 'auto', rect: AUTO_SOLO }]),
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const y = drawTitle(zc, 'How do you want to fly?', M);
    drawParagraph(zc, modeHint(ctx.flight), -zc.W / 2 + M, y, zc.W - 2 * M, THEME.color.textDim);
    if (ctx.flight.guided) {
      drawButton(zc, SMALL_BUTTONS.guided, 'GUIDED FLIGHT', ctx.level('guided'), 'accent', 'The trainer shows each step');
      drawButton(zc, SMALL_BUTTONS.auto, 'PRACTISE ALONE', ctx.level('auto'), 'neutral', 'No guidance, graded as flown');
    } else {
      drawButton(zc, AUTO_SOLO, 'PRACTISE ALONE', ctx.level('auto'), 'neutral', 'No guidance, graded as flown');
    }
  },
};
