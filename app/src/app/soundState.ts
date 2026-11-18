/**
 * Whether the shared AudioContext is silent right now (T49). index.ts keeps it in step with the context's `statechange`
 * events; the welcome screen reads it to show "Sound is off". No IWSDK or DOM imports, so the screens stay loadable in node.
 * Unknown counts as on: only a context that is known not to be running turns the line on.
 */
let off = false;

export function isSoundOff(): boolean {
  return off;
}

/** Returns true when the value changed (the caller then redraws the screens that show it). */
export function setSoundOff(value: boolean): boolean {
  if (off === value) return false;
  off = value;
  return true;
}
