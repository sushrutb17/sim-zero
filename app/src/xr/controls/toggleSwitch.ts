import { Color, Mesh, MeshLambertMaterial, Object3D } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { THEME } from '../theme';
import { GuardedToggleLogic, PressDebouncer, ToggleLogic } from './controlLogic';
import {
  boxGeometry,
  createGroup,
  createPad,
  padFront,
  readoutId,
  setLeverTarget,
  setPadEnabled,
  type CockpitControl,
  type ControlOptions,
} from './controlBase';
import { setLabel } from './labels';

export interface ToggleOptions extends ControlOptions {
  initial?: boolean;
  /** Guarded (elec.busTie): first press lifts the cover, second toggles. */
  guarded?: boolean;
  /** Hit base size; the whole base is the hit volume (>= 45 x 55 mm in the design). */
  base?: readonly [number, number];
  /** Trainer-layer styling (violet accent, visual-direction section 1): practice.toggle. */
  trainer?: boolean;
}

const LEVER_UP = 0.012;
const LEVER_DOWN = -0.012;

export function createToggle(id: ControlId, opts: ToggleOptions, bus: EventBus): CockpitControl & { entity: Entity; guardOpen(): boolean } {
  const guarded = opts.guarded ?? false;
  const plain = new ToggleLogic(opts.initial ?? false);
  const guard = new GuardedToggleLogic(opts.initial ?? false);
  const logic = guarded ? guard : plain;
  const [bw, bh] = opts.base ?? [guarded ? 0.06 : 0.045, 0.055];
  const { entity, group } = createGroup(opts.world, opts.parent, `ctl:${id}`, opts.local);
  const debounce = new PressDebouncer();
  const panel = opts.labelPanel ?? '';

  // paddle lever: a short bar on the base, up = ON
  const leverMat = new MeshLambertMaterial({ color: new Color(opts.trainer ? THEME.color.bezel : THEME.color.text), emissive: new Color(THEME.color.hover), emissiveIntensity: 0 });
  const lever = new Mesh(boxGeometry(0.014, 0.03, 0.01), leverMat);
  lever.name = `lever:${id}`;

  const showState = () => {
    setLabel(panel, readoutId(id), {
      text: logic.value ? 'ON' : 'OFF',
      color: logic.value ? (opts.trainer ? THEME.color.accent : THEME.display.normal) : THEME.color.textDim,
    });
    setLeverTarget(pad, logic.value ? LEVER_UP : LEVER_DOWN);
  };

  let cover: Object3D | undefined;
  let coverMat: MeshLambertMaterial | undefined;
  const { pad } = createPad(opts.world, {
    controlId: id,
    parent: entity,
    geometry: boxGeometry(bw, bh),
    at: [0, 0],
    centerZ: 0.006,
    name: `pad:${id}`,
    debounce,
    onPress: () => {
      if (guarded) {
        const r = guard.press();
        if (cover) cover.rotation.x = r.guardOpen ? -Math.PI * 0.55 : 0;
        if (!r.emit) return;
        showState();
        bus.emitAction({ kind: 'control', controlId: id, value: r.value });
      } else {
        const v = plain.press();
        showState();
        bus.emitAction({ kind: 'control', controlId: id, value: v });
      }
    },
  });
  if (opts.trainer) (pad.mesh.material as MeshLambertMaterial).color.set(THEME.color.accent);
  lever.position.set(0, logic.value ? LEVER_UP : LEVER_DOWN, 0.01);
  pad.mesh.add(lever);
  pad.materials.push(leverMat);
  pad.lever = { object: lever, target: logic.value ? LEVER_UP : LEVER_DOWN };

  if (guarded) {
    // hinged cover (top edge hinge): warning colour at 60% over panelEdge
    coverMat = new MeshLambertMaterial({
      color: new Color(THEME.color.panelEdge).lerp(new Color(THEME.alert.warning), 0.6),
      emissive: new Color(THEME.color.hover),
      emissiveIntensity: 0,
    });
    const hinge = new Object3D();
    hinge.position.set(0, bh / 2, 0.016);
    const flap = new Mesh(boxGeometry(bw * 0.94, bh * 0.94, 0.004), coverMat);
    flap.position.set(0, -bh / 2, 0);
    hinge.add(flap);
    pad.mesh.add(hinge);
    pad.materials.push(coverMat);
    cover = hinge;
  }
  showState();

  return {
    id,
    entity,
    object3d: group,
    guardOpen: () => guard.guardOpen,
    setValue(v) {
      if (typeof v === 'boolean') {
        logic.setValue(v);
        showState();
      }
    },
    setEnabled: (b) => setPadEnabled(pad, b),
    worldPosition: () => padFront(pad),
    partPosition: () => padFront(pad),
  };
}
