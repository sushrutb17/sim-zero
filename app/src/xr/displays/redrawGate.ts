/** Throttle for canvas redraws: at most one redraw per `minIntervalMs`, and only when marked dirty. Pure (no DOM). */
export class RedrawGate {
  private dirty = true;
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly minIntervalMs = 100) {}

  markDirty(): void {
    this.dirty = true;
  }

  /** True (and consumes the dirty flag) when a redraw is due at `nowMs`. */
  shouldRedraw(nowMs: number): boolean {
    if (!this.dirty || nowMs - this.last < this.minIntervalMs) return false;
    this.dirty = false;
    this.last = nowMs;
    return true;
  }
}
