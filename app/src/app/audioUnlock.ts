/**
 * Gesture hooks that resume the shared AudioContext (T49). Browsers only resume a suspended context inside a user
 * activation, and the Quest Browser's own Enter VR button gives the page none, so every real gesture we can see is
 * wired to `unlock`. The handlers call it synchronously: the activation does not survive a promise or a timer.
 * `unlock` must be cheap when the context is already running (TrainerAudio.unlock is a no-op then).
 */

interface Listenable {
  addEventListener(type: string, listener: () => void, options?: boolean | { capture?: boolean }): void;
}

/** Events on the 2D page that count as activation: a tap, a click or a key. */
export const PAGE_UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
/** WebXR input events a pinch (or a controller trigger/grip) raises on the session. */
export const SESSION_UNLOCK_EVENTS = ['selectstart', 'select', 'squeezestart'] as const;

/** Any tap, click or key anywhere on the page. Capture phase, so nothing on the page can stop it first. */
export function installPageGestureUnlock(unlock: () => void, target: Listenable = document): void {
  for (const type of PAGE_UNLOCK_EVENTS) target.addEventListener(type, () => unlock(), { capture: true });
}

/** A pinch or trigger press inside the immersive session. The listeners die with the session object. */
export function installSessionGestureUnlock(session: Listenable | null | undefined, unlock: () => void): void {
  if (!session) return;
  for (const type of SESSION_UNLOCK_EVENTS) session.addEventListener(type, () => unlock());
}
