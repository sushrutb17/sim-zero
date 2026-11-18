import { describe, expect, it } from 'vitest';
import { THEME } from '../../src/xr/theme';

// WCAG 2.x relative luminance and contrast ratio, written here so the test has no extra dependency.
function channelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channelToLinear((n >> 16) & 0xff) +
    0.7152 * channelToLinear((n >> 8) & 0xff) +
    0.0722 * channelToLinear(n & 0xff)
  );
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast helper (sanity)', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });
});

describe('THEME', () => {
  it('alert and text colours have contrast ≥ 4.5:1 against THEME.color.panel', () => {
    const panel = THEME.color.panel;
    const foregrounds: Record<string, string> = {
      'color.text': THEME.color.text,
      'color.textDim': THEME.color.textDim,
      'alert.warning': THEME.alert.warning,
      'alert.caution': THEME.alert.caution,
      'alert.advisory': THEME.alert.advisory,
    };
    for (const [name, colour] of Object.entries(foregrounds)) {
      expect(contrastRatio(colour, panel), `${name} ${colour} on panel ${panel}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('hoverFill / pressedFill keep text and textDim readable (>= 4.5:1)', () => {
    for (const fill of [THEME.color.hoverFill, THEME.color.pressedFill]) {
      expect(contrastRatio(THEME.color.text, fill), `text on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(THEME.color.textDim, THEME.color.hoverFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('minHitM ≥ 0.035', () => {
    expect(THEME.control.minHitM).toBeGreaterThanOrEqual(0.035);
  });

  it('every sfx file path is under /audio/sfx/', () => {
    const names = ['click', 'alertWarning', 'alertCaution', 'chime', 'ambient', 'radioIn'] as const;
    expect(Object.keys(THEME.sfx).sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(THEME.sfx[name].file, name).toMatch(/^\/audio\/sfx\/[a-zA-Z0-9_-]+\.(mp3|ogg|wav|m4a)$/);
      expect(Number.isFinite(THEME.sfx[name].gainDb), name).toBe(true);
    }
  });
});

describe('night direction (T21)', () => {
  it('button caps and the panel edge stay distinguishable from the panel face (>= 1.3:1)', () => {
    // Dark-on-dark surfaces are the main legibility risk of a night cockpit on an LCD headset.
    expect(contrastRatio(THEME.color.panelEdge, THEME.color.panel)).toBeGreaterThanOrEqual(1.3);
  });

  it('display text and alerts are readable on the display background (>= 4.5:1)', () => {
    for (const c of [THEME.color.text, THEME.color.textDim, THEME.display.normal, THEME.display.route, THEME.alert.warning, THEME.alert.caution, THEME.alert.advisory]) {
      expect(contrastRatio(c, THEME.display.bg), `${c} on display.bg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the outside is darker than the lettering, and the lightning flash is bounded', () => {
    for (const c of [THEME.outside.zenith, THEME.outside.horizonHaze, THEME.outside.cloud, THEME.outside.storm]) {
      expect(relativeLuminance(c), c).toBeLessThan(0.12);
    }
    expect(THEME.outside.stormFlashPeak).toBeGreaterThan(0);
    expect(THEME.outside.stormFlashPeak).toBeLessThanOrEqual(1);
    expect(THEME.display.glowOpacity).toBeGreaterThan(0);
    expect(THEME.display.glowOpacity).toBeLessThanOrEqual(0.5);
  });
});

describe('light tokens', () => {
  it('exist as hex colours and positive numbers', () => {
    expect(THEME.light.hemiSky).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME.light.hemiGround).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME.light.sunColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME.light.hemiIntensity).toBeGreaterThan(0);
    expect(THEME.light.sunIntensity).toBeGreaterThan(0);
  });
});
