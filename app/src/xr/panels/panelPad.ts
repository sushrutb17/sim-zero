/**
 * Hit pads for the canvas panels. A panel is ONE textured quad (one draw call); its buttons are invisible
 * hit boxes (material.visible = false: not rendered, still poke- and ray-interactable) registered in the same
 * pad registry as every cockpit control, so hover/press levels, debounce and the click hook come for free.
 * Dynamic lists (reply cards) reuse a fixed pool of pads: rect()/hide() move them without creating entities.
 */
import { BoxGeometry, Vector3, type Entity, type World } from '@iwsdk/core';
import { PressDebouncer } from '../controls/controlLogic';
import { createPad, type PadRuntime } from '../controls/controlBase';

/** Thickness of the invisible hit box and where its centre sits above the panel face (front face = 6 mm). */
const HIT_DEPTH = 0.004;
const HIT_CENTER_Z = 0.004;
const HIDDEN_Z = -5;

export interface PanelPad {
  id: string;
  pad: PadRuntime;
  /** Place the pad (zone-local centre and size) and enable it. */
  rect(cx: number, cy: number, w: number, h: number): void;
  hide(): void;
  setEnabled(b: boolean): void;
  /** 0..1 hover and press-flash levels (eased by CockpitControlSystem). */
  hover(): number;
  press(): number;
  /** World position of the front (poke) surface centre; undefined while hidden. */
  front(): Vector3 | undefined;
  visible(): boolean;
}

let shared: BoxGeometry | undefined;

export function createPanelPad(world: World, zone: Entity, id: string, onPress: () => void, debounce = new PressDebouncer()): PanelPad {
  shared ??= new BoxGeometry(1, 1, HIT_DEPTH);
  const { pad } = createPad(world, {
    controlId: `panel:${id}`,
    parent: zone,
    geometry: shared,
    at: [0, 0],
    centerZ: HIDDEN_Z,
    name: `pad:${id}`,
    debounce,
    onPress,
  });
  for (const m of pad.materials) m.visible = false; // not rendered; interaction unaffected
  pad.enabled = false;
  let shown = false;
  const self: PanelPad = {
    id,
    pad,
    rect(cx, cy, w, h) {
      pad.mesh.position.x = cx;
      pad.mesh.position.y = cy;
      pad.mesh.scale.set(w, h, 1);
      pad.restZ = HIT_CENTER_Z;
      pad.mesh.position.z = HIT_CENTER_Z;
      pad.enabled = true;
      shown = true;
    },
    hide() {
      pad.restZ = HIDDEN_Z;
      pad.mesh.position.z = HIDDEN_Z;
      pad.enabled = false;
      pad.hoverLevel = 0;
      pad.pressLevel = 0;
      shown = false;
    },
    setEnabled(b) {
      pad.enabled = b && shown;
    },
    hover: () => pad.hoverLevel,
    press: () => pad.pressLevel,
    visible: () => shown,
    front() {
      if (!shown) return undefined;
      pad.mesh.updateWorldMatrix(true, false);
      return pad.mesh.localToWorld(new Vector3(0, 0, HIT_DEPTH / 2));
    },
  };
  return self;
}
