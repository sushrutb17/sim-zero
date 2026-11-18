import { Mesh } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { THEME } from '../theme';
import { PressDebouncer, StepperLogic } from './controlLogic';
import {
  basicMaterial,
  boxGeometry,
  createGroup,
  createPad,
  padFront,
  readoutId,
  roundGeometry,
  setPadEnabled,
  type CockpitControl,
  type ControlOptions,
  type PadRuntime,
} from './controlBase';
import { setLabel } from './labels';

export interface StepperOptions extends ControlOptions {
  step: number;
  min: number;
  max: number;
  wrap?: boolean;
  initial: number;
  /** Text shown in the readout window (default: the number). */
  format?: (v: number) => string;
  /** Pad diameter (>= THEME.control.minHitM). */
  padDiameter?: number;
  /** Distance from readout centre to each pad centre. */
  padOffset?: number;
}

/** Two large -/+ pads and a value readout; no twist gesture. */
export function createStepperKnob(id: ControlId, opts: StepperOptions, bus: EventBus): CockpitControl & { entity: Entity } {
  const logic = new StepperLogic({ step: opts.step, min: opts.min, max: opts.max, wrap: opts.wrap, initial: opts.initial });
  const fmt = opts.format ?? ((v: number) => String(v));
  const dia = opts.padDiameter ?? 0.042;
  const off = opts.padOffset ?? 0.075;
  const { entity, group } = createGroup(opts.world, opts.parent, `ctl:${id}`, opts.local);
  const debounce = new PressDebouncer();
  const panel = opts.labelPanel ?? '';

  // readout window ("glass"): text itself is a UIKit label in the panel document
  const win = new Mesh(boxGeometry(0.06, 0.04, 0.004), basicMaterial(THEME.display.bg));
  win.position.set(0, 0, 0.002);
  win.name = `win:${id}`;
  group.add(win);

  const show = () => setLabel(panel, readoutId(id), { text: fmt(logic.value) });
  show();

  const mk = (dir: 1 | -1, part: string): PadRuntime =>
    createPad(opts.world, {
      controlId: id,
      parent: entity,
      geometry: roundGeometry(dia),
      at: [dir * off, 0],
      centerZ: 0.006,
      name: `pad:${id}:${part}`,
      debounce,
      onPress: () => {
        const next = logic.press(dir);
        show();
        bus.emitAction({ kind: 'control', controlId: id, value: next });
      },
    }).pad;
  const minus = mk(-1, 'minus');
  const plus = mk(1, 'plus');

  return {
    id,
    entity,
    object3d: group,
    setValue(v) {
      if (typeof v === 'number') {
        logic.setValue(v);
        show();
      }
    },
    setEnabled(b) {
      setPadEnabled(minus, b);
      setPadEnabled(plus, b);
    },
    worldPosition: () => padFront(plus),
    partPosition: (part) => (part === 'minus' ? padFront(minus) : part === 'plus' ? padFront(plus) : undefined),
  };
}
