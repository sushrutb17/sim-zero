/** Paused overlay and the finished screen (Task 11). Resume and Restart are hand presses. */
import { THEME } from '../../xr/theme';
import { SCREEN_GAP, SCREEN_MARGIN, SMALL_BUTTONS } from './layout';
import { drawButton, drawFrame, drawParagraph, drawSeatRow, drawTitle, type SmallScreen } from './ui';

/** What the Paused screen says (T51): each pad and what it does. */
export const PAUSED_TEXT = 'Scenario time is stopped. RESUME carries on. RESTART ends this flight and goes back to choosing a flight.';

export const pausedScreen: SmallScreen = {
  buttons: ['resume', 'abandon', 'seatFwd', 'seatBack'],
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const y = drawTitle(zc, 'Paused', M);
    // RESTART sits top right, so the text keeps to the left of it
    const textW = SMALL_BUTTONS.abandon.cx - SMALL_BUTTONS.abandon.w / 2 - SCREEN_GAP - (-zc.W / 2 + M);
    drawParagraph(zc, PAUSED_TEXT, -zc.W / 2 + M, y, textW, THEME.color.textDim);
    drawSeatRow(zc, ctx);
    drawButton(zc, SMALL_BUTTONS.abandon, 'RESTART', ctx.level('abandon'), 'outline');
    drawButton(zc, SMALL_BUTTONS.resume, 'RESUME', ctx.level('resume'));
  },
};

export const finishedScreen: SmallScreen = {
  buttons: ['again'],
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const y = drawTitle(zc, 'Thank you for flying', M);
    drawParagraph(zc, `${ctx.scenario.title} is complete. Restart to fly it again from the briefing.`, -zc.W / 2 + M, y, zc.W - 2 * M, THEME.color.textDim);
    drawButton(zc, SMALL_BUTTONS.again, 'RESTART', ctx.level('again'));
  },
};
