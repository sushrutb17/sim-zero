/** Guided-flight coach strip (Task 6): one accent head line and up to two body lines. Draw only; the host owns visibility. */
import type { ZoneCanvas } from '../../xr/panels/draw';
import { clampLines, lineHeightM, wrapText } from '../../xr/panels/textLayout';
import { THEME } from '../../xr/theme';
import { SCREEN_MARGIN } from './layout';
import { drawFrame } from './ui';

export interface CoachLines {
  head: string;
  body: string;
}

export function drawCoach(zc: ZoneCanvas, c: CoachLines): void {
  drawFrame(zc);
  const left = -zc.W / 2 + SCREEN_MARGIN;
  const minLh = lineHeightM('min');
  const bodyLh = lineHeightM('body');
  const lines = clampLines(wrapText(c.body, zc.W - 2 * SCREEN_MARGIN, zc.measurer('body', 500)), 2);
  const total = minLh + bodyLh * lines.length;
  let top = total / 2;
  zc.text(c.head, left, top - minLh / 2, 'min', THEME.color.accent, 'left', 700);
  top -= minLh;
  lines.forEach((l, i) => zc.text(l, left, top - bodyLh * (i + 0.5), 'body', THEME.color.text, 'left', 500));
}
