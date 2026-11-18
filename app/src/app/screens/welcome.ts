/** The project name the user chose on 2026-11-16 (T45): the page title, the loading and Start screens. */
export const PRODUCT_NAME = 'Sim Zero';
/** The welcome screen's title (T49). */
export const WELCOME_TITLE = `Welcome to ${PRODUCT_NAME}`;
/** Shown while the shared AudioContext is not running (T49); the headset gives the page no activation of its own. */
export const SOUND_OFF_LINE = 'Sound is off. Pinch any button to turn it on.';

/** Welcome (Task 11): the product name (T41: no longer a scenario title, the flight is chosen next), the scenario's notice (generic fictional aircraft, not real procedures), Continue, the seat buttons (T40) and the build stamp. */
import { THEME } from '../../xr/theme';
import { lineHeightM } from '../../xr/panels/textLayout';
import { formatBuildStamp } from '../buildInfo';
import { isSoundOff } from '../soundState';
import { SCREEN_GAP, SCREEN_MARGIN, SMALL_BUTTONS } from './layout';
import { drawButton, drawFrame, drawParagraph, drawSeatRow, drawTitle, type SmallScreen } from './ui';

export const welcomeScreen: SmallScreen = {
  buttons: ['continue', 'seatFwd', 'seatBack'],
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const left = -zc.W / 2 + M;
    const width = zc.W - 2 * M;
    let y = drawTitle(zc, WELCOME_TITLE, M);
    y = drawParagraph(zc, 'Cockpit scenario trainer', left, y, width, THEME.color.textDim, 600);
    y = drawParagraph(zc, ctx.scenario.notice, left, y - SCREEN_GAP / 2, width, THEME.color.text, 500);
    y = drawParagraph(zc, 'Poke a button with a fingertip, or point and pinch.', left, y - SCREEN_GAP / 2, width, THEME.color.textDim, 500);
    if (isSoundOff()) drawParagraph(zc, SOUND_OFF_LINE, left, y - SCREEN_GAP / 2, width, THEME.color.accent, 700);
    // Build stamp (T37): which version this headset is showing. Date and time only (T49): the commit id stays on the 2D
    // page. Top right, level with the title, since the bottom row now holds the seat buttons (T40).
    zc.text(formatBuildStamp(undefined, { commit: false }), zc.W / 2 - M, zc.H / 2 - M - lineHeightM('title') / 2, 'min', THEME.color.textDim, 'right', 500);
    drawSeatRow(zc, ctx);
    drawButton(zc, SMALL_BUTTONS.continue, 'CONTINUE', ctx.level('continue'));
  },
};
