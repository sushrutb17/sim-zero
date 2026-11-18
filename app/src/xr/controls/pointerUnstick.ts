/**
 * T23 workaround for an @iwsdk/xr-input 1.0.1 pointer lock.
 *
 * When a pinch-ray press lands on a pad that disappears as it is pressed (Continue, Begin, a reply card), the ray
 * has no intersection when the pinch is released. `MultiPointer.processButtonLifecycle` returns early in that case,
 * before it handles the release, so the ray stays in its "select" state with the button down. `MultiPointer.update`
 * then treats the hand as selection-locked and stops computing touch intersections: fingertip pokes with that hand
 * register nothing from then on.
 *
 * This system watches each hand. If the ray still holds a press a few frames after the pinch really ended, it turns
 * the ray sub-pointer off and on again through the SDK's public API. Turning it off makes the SDK cancel and release
 * the stale press; turning it back on returns it to normal. Nothing in node_modules is changed.
 * Verified in the IWER emulator only (e2e test (f)); not yet on a headset.
 */
import { createSystem } from '@iwsdk/core';
import { STUCK_FRAMES, nextStuckCount } from './pointerUnstickLogic';

type Hand = 'left' | 'right';
const HANDS: readonly Hand[] = ['left', 'right'];
/** Frames the ray stays off, so the SDK's input update sees the disabled state at least once whatever the system order. */
const OFF_FRAMES = 2;

export class PointerUnstickSystem extends createSystem({}) {
  private held!: Record<Hand, boolean>;
  private stuck!: Record<Hand, number>;
  private offFor!: Record<Hand, number>;
  private session: XRSession | null = null;
  private onSelectStart!: (e: XRInputSourceEvent) => void;
  private onSelectEnd!: (e: XRInputSourceEvent) => void;

  init(): void {
    this.held = { left: false, right: false };
    this.stuck = { left: 0, right: 0 };
    this.offFor = { left: 0, right: 0 };
    const mark = (e: XRInputSourceEvent, value: boolean) => {
      const h = e.inputSource.handedness;
      if (h === 'left' || h === 'right') this.held[h] = value;
    };
    this.onSelectStart = (e) => mark(e, true);
    this.onSelectEnd = (e) => mark(e, false);

    const xr = this.world.renderer.xr;
    const detach = () => {
      this.session?.removeEventListener('selectstart', this.onSelectStart);
      this.session?.removeEventListener('selectend', this.onSelectEnd);
      this.session = null;
      this.held.left = this.held.right = false;
    };
    const attach = () => {
      detach();
      this.session = xr.getSession();
      this.session?.addEventListener('selectstart', this.onSelectStart);
      this.session?.addEventListener('selectend', this.onSelectEnd);
    };
    xr.addEventListener('sessionstart', attach);
    xr.addEventListener('sessionend', detach);
    if (xr.isPresenting) attach();
    this.cleanupFuncs.push(() => {
      xr.removeEventListener('sessionstart', attach);
      xr.removeEventListener('sessionend', detach);
      detach();
    });
  }

  update(): void {
    for (const hand of HANDS) {
      const pointers = this.world.input.xr.multiPointers[hand];
      if (this.offFor[hand] > 0) {
        if (--this.offFor[hand] === 0) pointers.toggleSubPointer('ray', true);
        continue;
      }
      this.stuck[hand] = nextStuckCount(this.stuck[hand], {
        rayActive: pointers.getActiveKind() === 'ray',
        buttonDown: pointers.getPointer('ray').getButtonsDown().size > 0,
        selectHeld: this.held[hand],
      });
      if (this.stuck[hand] >= STUCK_FRAMES) {
        this.stuck[hand] = 0;
        pointers.toggleSubPointer('ray', false);
        this.offFor[hand] = OFF_FRAMES;
      }
    }
  }
}
