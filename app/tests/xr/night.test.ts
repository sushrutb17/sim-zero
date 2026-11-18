import { describe, expect, it } from 'vitest';
import { glowAlpha } from '../../src/xr/cockpit/glow';
import { flashLevel, nextFlashAt } from '../../src/xr/outside/sky';

describe('display glow falloff (T21)', () => {
  it('is full under the display, zero at the quad edge, and never rises with distance', () => {
    expect(glowAlpha(0)).toBe(1);
    expect(glowAlpha(1)).toBe(0);
    expect(glowAlpha(1.4)).toBe(0); // quad corners are beyond radius 1
    let prev = 1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const a = glowAlpha(r);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      expect(a).toBeGreaterThanOrEqual(0);
      prev = a;
    }
  });
});

describe('lightning timing (T21, comfort)', () => {
  it('is dark before the flash, peaks at its start and has decayed within 1.5 s', () => {
    expect(flashLevel(9.9, 10)).toBe(0);
    expect(flashLevel(10, 10)).toBe(1);
    expect(flashLevel(11.5, 10)).toBeLessThan(0.01);
  });

  it('has at most two pulses per flash (one peak and one weaker echo)', () => {
    let rises = 0;
    let prev = flashLevel(10, 10);
    let rising = false;
    for (let t = 10.005; t < 12; t += 0.005) {
      const v = flashLevel(t, 10);
      if (v > prev + 1e-6 && !rising) { rises++; rising = true; }
      if (v < prev) rising = false;
      prev = v;
    }
    expect(rises).toBe(1); // the echo is the only rise after the initial peak
    expect(flashLevel(10.2, 10)).toBeLessThanOrEqual(0.6);
  });

  it('leaves at least 6 s between flashes, so the rate stays far below 3 flashes per second', () => {
    expect(nextFlashAt(100, 0) - 100).toBeGreaterThanOrEqual(6);
    expect(nextFlashAt(100, 1) - 100).toBeLessThanOrEqual(13);
  });
});
