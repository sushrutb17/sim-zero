/** Briefing (Task 11): points the judge to the kneeboard briefing pages, then Begin starts Event Set 1. */
import { THEME } from '../../xr/theme';
import { SCREEN_GAP, SCREEN_MARGIN, SMALL_BUTTONS } from './layout';
import { drawButton, drawFrame, drawParagraph, drawTitle, type SmallScreen } from './ui';

export const briefingScreen: SmallScreen = {
  buttons: ['begin'],
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const left = -zc.W / 2 + M;
    const width = zc.W - 2 * M;
    let y = drawTitle(zc, 'Briefing', M);
    y = drawParagraph(zc, 'Read the briefing on the kneeboard to your left. NEXT and PREV turn its pages.', left, y - SCREEN_GAP / 4, width);
    drawParagraph(zc, 'Press BEGIN when you are ready. PAUSE on the kneeboard stops the clock.', left, y - SCREEN_GAP / 2, width - SMALL_BUTTONS.begin.w - SCREEN_GAP, THEME.color.textDim);
    drawButton(zc, SMALL_BUTTONS.begin, 'BEGIN', ctx.level('begin'));
  },
};
