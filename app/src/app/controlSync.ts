/**
 * Keeps every cockpit control's displayed value equal to the live AircraftState (replaces the Task 8 placeholders).
 * Writes only when a value changed, or when the control was pressed (`invalidate`): a press flips the control's own
 * logic, so if the engine did not take the action (outside running/redo) the next sync puts the old value back.
 * No allocation per call.
 */
import type { AircraftState, ControlId } from '../contracts/aircraft';

export interface SettableControl {
  setValue(v: unknown): void;
}

type Read = (s: AircraftState) => number | boolean | string;

const BINDINGS: ReadonlyArray<readonly [ControlId, Read]> = [
  ['ap.hdg', (s) => s.ap.hdg],
  ['ap.alt', (s) => s.ap.alt],
  ['ap.engage', (s) => s.ap.engaged],
  ['ap.lateral', (s) => s.ap.lateral],
  ['ap.vertical', (s) => s.ap.vertical],
  ['baro.set', (s) => s.baroHpa],
  ['lights.landing', (s) => s.lights.landing],
  ['lights.strobe', (s) => s.lights.strobe],
  ['elec.gen1', (s) => s.elec.gen1.switchOn],
  ['elec.gen2', (s) => s.elec.gen2.switchOn],
  ['elec.busTie', (s) => s.elec.busTie],
];

export class ControlSync {
  private readonly targets: Array<SettableControl | undefined>;
  private readonly last: Array<number | boolean | string | undefined>;
  private readonly index = new Map<ControlId, number>();

  constructor(controls: ReadonlyMap<ControlId, SettableControl>) {
    this.targets = BINDINGS.map(([id]) => controls.get(id));
    this.last = BINDINGS.map(() => undefined);
    BINDINGS.forEach(([id], i) => this.index.set(id, i));
  }

  /** Forget the last written value of `id` (it was pressed): the next sync rewrites it. */
  invalidate(id: ControlId): void {
    const i = this.index.get(id);
    if (i !== undefined) this.last[i] = undefined;
  }

  invalidateAll(): void {
    this.last.fill(undefined);
  }

  sync(s: AircraftState): void {
    for (let i = 0; i < BINDINGS.length; i++) {
      const v = BINDINGS[i][1](s);
      if (v === this.last[i]) continue;
      this.last[i] = v;
      this.targets[i]?.setValue(v);
    }
  }
}
