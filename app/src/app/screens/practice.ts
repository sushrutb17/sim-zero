/**
 * Practice (Task 11, spec 4.1 "training wheels"): the scenario's prompt asks for one press of the practice switch on
 * the kneeboard (to the judge's left). The flow advances on that press; there is no button here.
 */
import { THEME } from '../../xr/theme';
import { SCREEN_GAP, SCREEN_MARGIN } from './layout';
import { drawFrame, drawParagraph, drawTitle, type SmallScreen } from './ui';

export const practiceScreen: SmallScreen = {
  buttons: [],
  draw(zc, ctx) {
    drawFrame(zc);
    const M = SCREEN_MARGIN;
    const arrowW = 0.05;
    const left = -zc.W / 2 + M + arrowW + SCREEN_GAP;
    const width = zc.W / 2 - M - left;
    let y = drawTitle(zc, 'Quick practice', M);
    y = drawParagraph(zc, ctx.scenario.practice.prompt, left, y - SCREEN_GAP / 2, width, THEME.color.text, 600);
    drawParagraph(zc, 'It is on the kneeboard, to your left. You can also point at it and pinch.', left, y - SCREEN_GAP / 2, width, THEME.color.textDim);
    // violet arrow pointing left (geometry, not a glyph: the headset font has no arrows)
    const c = zc.ctx;
    const ax = -zc.W / 2 + M;
    const ay = -0.02;
    c.beginPath();
    c.moveTo(zc.px(ax), zc.py(ay));
    c.lineTo(zc.px(ax + arrowW), zc.py(ay + 0.03));
    c.lineTo(zc.px(ax + arrowW), zc.py(ay - 0.03));
    c.closePath();
    c.fillStyle = THEME.color.accent;
    c.fill();
  },
};
