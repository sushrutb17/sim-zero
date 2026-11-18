/**
 * Pure part of the T23 workaround (see pointerUnstick.ts): decides when a ray press has outlived the pinch.
 * No @iwsdk/core import, so it is unit-tested headless.
 */

/** Frames a ray press may outlive the pinch before it is treated as stuck. More than one, so an ordinary release is processed first. */
export const STUCK_FRAMES = 3;

export interface RaySample {
  /** The ray is the hand's active pointer. */
  rayActive: boolean;
  /** The ray pointer still reports a button held down. */
  buttonDown: boolean;
  /** The hand is really pinching (between the session's selectstart and selectend). */
  selectHeld: boolean;
}

/** Consecutive frames in which the ray still holds a press although the hand is no longer pinching. */
export function nextStuckCount(count: number, s: RaySample): number {
  return s.rayActive && s.buttonDown && !s.selectHeld ? count + 1 : 0;
}
