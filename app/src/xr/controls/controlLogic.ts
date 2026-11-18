/**
 * Pure control logic (no @iwsdk/core / three imports) so vitest can test it in node.
 * The IWSDK meshes in pushButton.ts / toggleSwitch.ts / stepperKnob.ts / optionSelector.ts
 * drive these classes; they never contain their own state machines.
 */

/** Presses on the same control within this window of the last ACCEPTED press are ignored. */
export const DEBOUNCE_MS = 250;

export class PressDebouncer {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** True if this press is accepted (and starts a new window); false if it is inside the window. */
  accept(): boolean {
    const t = this.now();
    if (t - this.last < DEBOUNCE_MS) return false;
    this.last = t;
    return true;
  }
}

/** Latching boolean: a push-button latch or a plain toggle. */
export class ToggleLogic {
  value: boolean;
  constructor(initial = false) {
    this.value = initial;
  }
  press(): boolean {
    this.value = !this.value;
    return this.value;
  }
  setValue(v: boolean): void {
    this.value = v;
  }
}

export type GuardedPressResult =
  | { emit: false; guardOpen: boolean }
  | { emit: true; value: boolean; guardOpen: boolean };

/** elec.busTie: first press lifts the guard (no action), second press toggles and the guard drops again. */
export class GuardedToggleLogic {
  value: boolean;
  guardOpen = false;
  constructor(initial = false) {
    this.value = initial;
  }
  press(): GuardedPressResult {
    if (!this.guardOpen) {
      this.guardOpen = true;
      return { emit: false, guardOpen: true };
    }
    this.guardOpen = false;
    this.value = !this.value;
    return { emit: true, value: this.value, guardOpen: false };
  }
  /** Display sync from aircraft state; never touches the guard. */
  setValue(v: boolean): void {
    this.value = v;
  }
}

export interface StepperConfig {
  step: number;
  min: number;
  max: number;
  /** Wrap around within [min, max] (heading 359 -> 0) instead of clamping. */
  wrap?: boolean;
  initial: number;
}

export class StepperLogic {
  value: number;
  constructor(private readonly cfg: StepperConfig) {
    this.value = cfg.initial;
  }

  /** dir = +1 / -1. Returns the new (possibly clamped, unchanged) value; every accepted press emits it. */
  press(dir: 1 | -1): number {
    const { step, min, max, wrap } = this.cfg;
    let next = this.value + dir * step;
    if (wrap) {
      const size = max - min + 1;
      next = ((((next - min) % size) + size) % size) + min;
    } else {
      next = Math.min(max, Math.max(min, next));
    }
    this.value = next;
    return next;
  }

  /** Display sync from aircraft state; no emit. */
  setValue(v: number): void {
    this.value = v;
  }
}

/** A set of mutually exclusive string options (ap.lateral, ap.vertical, the route panel's rows). */
export class OptionLogic {
  private index: number;
  constructor(
    readonly options: readonly string[],
    initial: string = options[0],
  ) {
    this.index = Math.max(0, options.indexOf(initial));
  }
  get value(): string {
    return this.options[this.index];
  }
  /** Advance to the next option (wrapping) and return it. */
  cycle(): string {
    this.index = (this.index + 1) % this.options.length;
    return this.value;
  }
  /** Select option `i` directly and return its value. */
  select(i: number): string {
    this.index = Math.min(this.options.length - 1, Math.max(0, i));
    return this.value;
  }
  /** Display sync; unknown values are ignored. */
  setValue(v: string): void {
    const i = this.options.indexOf(v);
    if (i >= 0) this.index = i;
  }
}
