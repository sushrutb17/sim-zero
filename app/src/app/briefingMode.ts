/**
 * Passthrough briefing (F29, Should). Pure decision + session-switch logic with injected session calls, so the
 * "never a dead end" rule is unit-tested: any failure on the way into the cockpit lands in immersive-vr.
 *
 * Runtime status (Task 11): the app ships the VIRTUAL briefing room only (chooseBriefingMode(false)). IWSDK 1.0.1's
 * World.launchXR() returns void (no promise, no error), and requesting a second immersive session after ending the
 * first needs a fresh user activation, which an IWSDK poke press does not provide (it is not an XR `select` event).
 * See docs/iwsdk-notes.md "Passthrough briefing (F29)".
 */

export type BriefingMode = 'passthrough' | 'virtualRoom';
export type SessionKind = 'immersive-ar' | 'immersive-vr';

export function chooseBriefingMode(supportsAR: boolean): BriefingMode {
  return supportsAR ? 'passthrough' : 'virtualRoom';
}

/** Session kind for the welcome/briefing part of the flow. */
export function briefingSessionKind(mode: BriefingMode): SessionKind {
  return mode === 'passthrough' ? 'immersive-ar' : 'immersive-vr';
}

/** Request `preferred`; if that fails and it was not already immersive-vr, request immersive-vr instead. */
export async function requestWithFallback(preferred: SessionKind, request: (k: SessionKind) => Promise<void>): Promise<SessionKind> {
  try {
    await request(preferred);
    return preferred;
  } catch (err) {
    if (preferred === 'immersive-vr') throw err;
    await request('immersive-vr');
    return 'immersive-vr';
  }
}

/** "Begin" from a passthrough briefing: end the AR session (errors ignored), then enter the cockpit in immersive-vr. */
export async function switchToCockpit(deps: { end: () => Promise<void>; request: (k: SessionKind) => Promise<void> }): Promise<SessionKind> {
  try {
    await deps.end();
  } catch {
    // the session may already be gone; the cockpit request below is what matters
  }
  return requestWithFallback('immersive-vr', deps.request);
}
