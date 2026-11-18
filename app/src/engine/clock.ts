/** Scenario time source. Pure TS, headless. */
export class ScenarioClock {
  now = 0;
  paused = false;

  /** Advance by dtSec; returns the dt actually applied (0 if paused or dt <= 0). */
  advance(dtSec: number): number {
    if (this.paused || !(dtSec > 0)) return 0;
    this.now += dtSec;
    return dtSec;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
}
