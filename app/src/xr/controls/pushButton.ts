import type { Entity } from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { PressDebouncer, ToggleLogic } from './controlLogic';
import {
  addIndicatorBar,
  boxGeometry,
  createGroup,
  createPad,
  padFront,
  setPadEnabled,
  type CockpitControl,
  type ControlOptions,
} from './controlBase';

export interface PushButtonOptions extends ControlOptions {
  size: readonly [number, number];
  /** Latching (default): each press toggles and emits the new boolean, with an indicator bar. */
  latching?: boolean;
  /** Non-latching: the constant emitted by every press (e.g. an acknowledge). */
  value?: boolean | number | string;
  initial?: boolean;
}

export function createPushButton(id: ControlId, opts: PushButtonOptions, bus: EventBus): CockpitControl & { entity: Entity } {
  const latching = opts.latching ?? true;
  const logic = new ToggleLogic(opts.initial ?? false);
  const { entity, group } = createGroup(opts.world, opts.parent, `ctl:${id}`, opts.local);
  const debounce = new PressDebouncer();
  const [w, h] = opts.size;
  let setBar: ((lit: boolean) => void) | undefined;
  const { pad } = createPad(opts.world, {
    controlId: id,
    parent: entity,
    geometry: boxGeometry(w, h),
    at: [0, 0],
    centerZ: 0.006,
    name: `pad:${id}`,
    debounce,
    onPress: () => {
      const value = latching ? logic.press() : (opts.value ?? true);
      if (latching) setBar?.(logic.value);
      bus.emitAction({ kind: 'control', controlId: id, value });
    },
  });
  if (latching) {
    setBar = addIndicatorBar(pad, w, h);
    setBar(logic.value);
  }
  return {
    id,
    entity,
    object3d: group,
    setValue(v) {
      if (typeof v === 'boolean') {
        logic.setValue(v);
        setBar?.(v);
      }
    },
    setEnabled: (b) => setPadEnabled(pad, b),
    worldPosition: () => padFront(pad),
    partPosition: () => padFront(pad),
  };
}
