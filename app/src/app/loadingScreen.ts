/**
 * Removes the static loading screen from index.html (#loading). Called once the welcome screen has been drawn
 * (screens.welcomeDrawnAt() is set), the same moment the dev hook coldStartMs reports. Not a dev hook: it runs in
 * production. Safe to call every frame (a no-op after the first call) and when the element does not exist.
 */
let removed = false;
const FADE_MS = 200;

export function removeLoadingScreen(): void {
  if (removed || typeof document === 'undefined') return;
  removed = true;
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('done'); // CSS fades the opacity (instant under prefers-reduced-motion)
  // setTimeout, not requestAnimationFrame / transitionend: those do not fire reliably while an XR session is active.
  setTimeout(() => el.remove(), FADE_MS + 50);
}
