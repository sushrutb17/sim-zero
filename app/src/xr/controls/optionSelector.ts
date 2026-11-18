import type { Entity } from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { OptionLogic, PressDebouncer } from './controlLogic';
import {
  addIndicatorBar,
  boxGeometry,
  createGroup,
  createPad,
  padFront,
  setPadEnabled,
  type CockpitControl,
  type ControlOptions,
  type PadRuntime,
} from './controlBase';

export interface OptionSelectorOptions extends ControlOptions {
  options: string[];
  initial?: string;
  padSize: readonly [number, number];
  /** Centre-to-centre distance between pads (default: pad width + 0.017). */
  pitch?: number;
  /** Stack pads vertically (route rows) instead of side by side. */
  vertical?: boolean;
  /** 'pads' (default): one pad per option, press selects it. 'cycle': one pad, press advances. */
  mode?: 'pads' | 'cycle';
}

/** Option pads (ap.lateral, ap.vertical). Emits the chosen option string. */
export function createOptionSelector(id: ControlId, opts: OptionSelectorOptions, bus: EventBus): CockpitControl & { entity: Entity } {
  const logic = new OptionLogic(opts.options, opts.initial);
  const { entity, group } = createGroup(opts.world, opts.parent, `ctl:${id}`, opts.local);
  const debounce = new PressDebouncer();
  const [w, h] = opts.padSize;
  const mode = opts.mode ?? 'pads';
  const n = mode === 'cycle' ? 1 : opts.options.length;
  const pitch = opts.pitch ?? (opts.vertical ? h + 0.012 : w + 0.017);
  const bars: Array<(lit: boolean) => void> = [];
  const padList: PadRuntime[] = [];

  const refresh = () => {
    if (mode === 'cycle') bars[0]?.(true);
    else bars.forEach((set, i) => set(opts.options[i] === logic.value));
  };

  for (let i = 0; i < n; i++) {
    const c = (i - (n - 1) / 2) * pitch;
    const { pad } = createPad(opts.world, {
      controlId: id,
      parent: entity,
      geometry: boxGeometry(w, h),
      at: opts.vertical ? [0, -c] : [c, 0],
      centerZ: 0.006,
      name: `pad:${id}:${opts.options[i]}`,
      debounce,
      onPress: () => {
        const value = mode === 'cycle' ? logic.cycle() : logic.select(i);
        refresh();
        bus.emitAction({ kind: 'control', controlId: id, value });
      },
    });
    bars.push(addIndicatorBar(pad, w, h));
    padList.push(pad);
  }
  refresh();

  return {
    id,
    entity,
    object3d: group,
    setValue(v) {
      if (typeof v === 'string') {
        logic.setValue(v);
        refresh();
      }
    },
    setEnabled: (b) => padList.forEach((p) => setPadEnabled(p, b)),
    worldPosition: () => padFront(padList[0]),
    partPosition: (part) => {
      const i = opts.options.indexOf(part);
      return i >= 0 && padList[mode === 'cycle' ? 0 : i] ? padFront(padList[mode === 'cycle' ? 0 : i]) : undefined;
    },
  };
}
