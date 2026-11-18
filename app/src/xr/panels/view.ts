import type { Vector3 } from '@iwsdk/core';

/** What every panel view offers the Panels facade. */
export interface PanelView {
  /** Per-frame work: deferred relayout, hover redraw gating, canvas redraw (<= 10 Hz, only when dirty). */
  tick(nowMs: number): void;
  reset(): void;
  /** Dev hook targets: id -> world position of the press surface (undefined when not currently shown). */
  targets(): Record<string, () => Vector3 | undefined>;
}
