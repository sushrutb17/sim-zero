// T37: the build stamp shown on the welcome screen and the 2D page.
import { describe, expect, it } from 'vitest';
import { inter } from '@pmndrs/msdfonts';
import { BUILD_INFO, formatBuildStamp } from '../../src/app/buildInfo';
import { SCREENS, SCREEN_GAP, SCREEN_MARGIN, SMALL_BUTTONS } from '../../src/app/screens/layout';
import { THEME, fontSizeForCap } from '../../src/xr/theme';

describe('formatBuildStamp', () => {
  it('shows the local date, time and commit', () => {
    const info = { time: '2026-11-15T21:42:00.000Z', commit: '7721119' };
    expect(formatBuildStamp(info, { locale: 'en-US', timeZone: 'America/Toronto' }).replace(/ /g, ' ')).toBe('Build Nov 15, 4:42 PM · 7721119');
    expect(formatBuildStamp(info, { locale: 'en-US', timeZone: 'UTC' }).replace(/ /g, ' ')).toBe('Build Nov 15, 9:42 PM · 7721119');
  });

  it('T49: leaves the commit id out on request (the headset shows date and time only)', () => {
    const info = { time: '2026-11-15T21:42:00.000Z', commit: '7721119' };
    const opts = { locale: 'en-US', timeZone: 'America/Toronto', commit: false };
    expect(formatBuildStamp(info, opts).replace(/\u202f/g, ' ')).toBe('Build Nov 15, 4:42 PM');
    expect(formatBuildStamp(info, opts)).not.toContain('7721119');
    expect(formatBuildStamp(info, { ...opts, commit: true }).replace(/\u202f/g, ' ')).toBe('Build Nov 15, 4:42 PM · 7721119');
    expect(formatBuildStamp(null, opts)).toBe('Build unknown');
    expect(formatBuildStamp({ time: 'not a date', commit: 'abc1234' }, opts)).toBe('Build unknown');
  });

  it('falls back when the build gave no stamp or a bad time', () => {
    expect(BUILD_INFO).toBeNull(); // the define exists only in a Vite build
    expect(formatBuildStamp(null)).toBe('Build unknown');
    expect(formatBuildStamp()).toBe('Build unknown');
    expect(formatBuildStamp({ time: 'not a date', commit: 'abc1234' })).toBe('Build abc1234');
  });

  it('fits left of the CONTINUE button on the welcome screen at the minimum text size', () => {
    // same estimator as tests/app/screens.test.ts: real Inter advance widths, 6% safety
    const face = inter.medium;
    const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
    const width = (t: string) => ([...t].reduce((a, ch) => a + (adv.get(ch) ?? adv.get('n')!), 0) / face.info.size) * fontSizeForCap(THEME.text.capM.min) * 1.06;
    const [W] = SCREENS.small.size;
    const button = SMALL_BUTTONS.continue;
    const room = button.cx - button.w / 2 - SCREEN_GAP - (-W / 2 + SCREEN_MARGIN);
    expect(width('Build Nov 28, 12:48 PM · 0000000')).toBeLessThan(room); // the widest stamp: two-digit day and hour
  });
});
