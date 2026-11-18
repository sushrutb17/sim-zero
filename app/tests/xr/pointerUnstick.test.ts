import { describe, expect, it } from 'vitest';
import { STUCK_FRAMES, nextStuckCount } from '../../src/xr/controls/pointerUnstickLogic';

const stuck = { rayActive: true, buttonDown: true, selectHeld: false };

describe('stuck ray press detector (T23)', () => {
  it('counts consecutive frames in which the ray still holds a press after the pinch has ended', () => {
    let n = 0;
    for (let i = 1; i <= STUCK_FRAMES; i++) {
      n = nextStuckCount(n, stuck);
      expect(n).toBe(i);
    }
  });

  it('never counts while the pinch is really held (a normal press, however long)', () => {
    let n = 0;
    for (let i = 0; i < 200; i++) n = nextStuckCount(n, { ...stuck, selectHeld: true });
    expect(n).toBe(0);
  });

  it('never counts when the ray has no button down or is not the active pointer', () => {
    expect(nextStuckCount(0, { ...stuck, buttonDown: false })).toBe(0);
    expect(nextStuckCount(0, { ...stuck, rayActive: false })).toBe(0);
  });

  it('resets as soon as the press is released normally', () => {
    let n = nextStuckCount(0, stuck);
    n = nextStuckCount(n, stuck);
    expect(n).toBe(2);
    expect(nextStuckCount(n, { ...stuck, buttonDown: false })).toBe(0);
  });

  it('waits more than one frame, so the SDK can process an ordinary release first', () => {
    expect(STUCK_FRAMES).toBeGreaterThanOrEqual(2);
  });
});
