/**
 * Shared IWSDK plumbing for every cockpit control: the CockpitControl interface, the pad registry the
 * ECS system reads, mesh factories (THEME tokens only) and the click hook (audio is wired in Task 12).
 * Control STATE lives in controlLogic.ts; this file only holds visuals + registration.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PokeInteractable,
  RayInteractable,
  Vector3,
  type BufferGeometry,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import { THEME } from '../theme';
import type { AuxPadId, PanelPadId } from '../cockpit/layout';
import { PressDebouncer } from './controlLogic';
import { CockpitPad } from './components';

export interface CockpitControl {
  id: ControlId;
  object3d: Object3D;
  /** Update the displayed value from aircraft state. Never emits an action. */
  setValue(v: unknown): void;
  setEnabled(b: boolean): void;
  /** World position of the control's primary press surface. */
  worldPosition(): Vector3;
  /** World position of a named press surface (stepper: 'plus' | 'minus'; selector: option value). */
  partPosition?(part: string): Vector3 | undefined;
}

/** Everything a control factory needs besides its own options. `local` is [x, y] in the parent's frame. */
export interface ControlOptions {
  world: World;
  /** Entity of the zone panel this control sits on (its object3D is the zone frame). */
  parent: Entity;
  local: readonly [number, number];
  /** Key of the UIKitML label panel (labels.ts) showing this control's readout, if any. */
  labelPanel?: string;
}

/** How far a control cap stands proud of its panel face (metres). */
export const CAP_DEPTH = 0.012;

// ---- click hook (Task 12 plays the click sfx here) ----
/** Id of any pad that produces a click: a ControlId, a Task 9 aux pad (alerts.ack, magnify tabs) or a Task 10 panel pad. */
export type PadId = ControlId | AuxPadId | PanelPadId;
type ClickListener = (id: PadId) => void;
const clickListeners = new Set<ClickListener>();
/** Subscribe to every physical press contact (including ones the debouncer rejects). Returns unsubscribe. */
export function onControlClick(cb: ClickListener): () => void {
  clickListeners.add(cb);
  return () => clickListeners.delete(cb);
}
export function fireClick(id: PadId): void {
  for (const cb of clickListeners) cb(id);
}

// ---- pad registry (read by controlSystem.ts) ----
export interface PadRuntime {
  controlId: PadId;
  mesh: Mesh;
  /** Materials that take the hover/press emissive (cap + optional extras such as a guard cover). */
  materials: MeshLambertMaterial[];
  restZ: number;
  enabled: boolean;
  hoverLevel: number;
  pressLevel: number;
  flashUntil: number;
  lastEmissive: number;
  /** Optional lever whose local y is eased toward `target` (toggle flip, 80 ms). */
  lever?: { object: Object3D; target: number };
  onPress(): void;
}
export const pads: PadRuntime[] = [];

export interface PadSpec {
  controlId: PadId;
  parent: Entity;
  geometry: BufferGeometry;
  /** Local position of the pad's front-face centre relative to the parent frame [x, y]. */
  at: readonly [number, number];
  /** Z of the pad mesh centre above the panel face (metres). */
  centerZ: number;
  name: string;
  onPress(): void;
  /** Debouncer shared by all pads of one control. */
  debounce: PressDebouncer;
}

export function capMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color: new Color(THEME.color.panelEdge),
    emissive: new Color(THEME.color.hover),
    emissiveIntensity: 0,
  });
}

/** Create one interactive pad entity (poke + pinch-ray) and register it. */
export function createPad(world: World, spec: PadSpec): { entity: Entity; pad: PadRuntime } {
  const material = capMaterial();
  const mesh = new Mesh(spec.geometry, material);
  mesh.name = spec.name;
  mesh.position.set(spec.at[0], spec.at[1], spec.centerZ);
  const pad: PadRuntime = {
    controlId: spec.controlId,
    mesh,
    materials: [material],
    restZ: spec.centerZ,
    enabled: true,
    hoverLevel: 0,
    pressLevel: 0,
    flashUntil: 0,
    lastEmissive: -1,
    onPress: () => {
      // Feedback first: the pilot always sees the press register, even if the action is debounced/rejected.
      pad.flashUntil = performance.now() + THEME.control.pressFlashMs;
      fireClick(spec.controlId);
      if (!pad.enabled) return;
      if (!spec.debounce.accept()) return;
      spec.onPress();
    },
  };
  const entity = world.createTransformEntity(mesh, spec.parent);
  entity.addComponent(RayInteractable);
  entity.addComponent(PokeInteractable);
  entity.addComponent(CockpitPad, { handler: pads.length });
  pads.push(pad);
  return { entity, pad };
}

// ---- mesh helpers ----
export function boxGeometry(w: number, h: number, d = CAP_DEPTH): BoxGeometry {
  return new BoxGeometry(w, h, d);
}

/** Round pad (cylinder axis along +Z). */
export function roundGeometry(diameter: number, d = CAP_DEPTH): CylinderGeometry {
  const g = new CylinderGeometry(diameter / 2, diameter / 2, d, 24);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Self-lit flat colour (indicator bars, readout windows). */
export function basicMaterial(hex: string): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(hex), toneMapped: false });
}

/** Add an indicator bar along the top edge of a cap; returns a setter (lit = display.normal). */
export function addIndicatorBar(pad: PadRuntime, capW: number, capH: number): (lit: boolean) => void {
  const mat = basicMaterial(THEME.color.bezel);
  const bar = new Mesh(new BoxGeometry(capW * 0.62, 0.004, 0.001), mat);
  bar.position.set(0, capH / 2 - 0.006, CAP_DEPTH / 2 + 0.0006);
  pad.mesh.add(bar);
  const on = new Color(THEME.display.normal);
  const off = new Color(THEME.color.bezel);
  return (lit) => mat.color.copy(lit ? on : off);
}

/** Tell the system which way a lever should sit (eased). */
export function setLeverTarget(pad: PadRuntime, target: number): void {
  if (pad.lever) pad.lever.target = target;
}

/** World position of a pad's front (press) face at rest. Allocates; for hooks and tests only. */
export function padFront(pad: PadRuntime): Vector3 {
  pad.mesh.updateWorldMatrix(true, false);
  return pad.mesh.localToWorld(new Vector3(0, 0, CAP_DEPTH / 2));
}

/** Group node for one control, parented under its zone panel. */
export function createGroup(world: World, parent: Entity, name: string, local: readonly [number, number]): { entity: Entity; group: Object3D } {
  const group = new Object3D();
  group.name = name;
  group.position.set(local[0], local[1], 0);
  const entity = world.createTransformEntity(group, parent);
  return { entity, group };
}

export function readoutId(id: ControlId): string {
  return `val-${id.replace('.', '-')}`;
}

export function setPadEnabled(p: PadRuntime, b: boolean): void {
  p.enabled = b;
  for (const m of p.materials) {
    m.transparent = !b;
    m.opacity = b ? 1 : 0.4;
  }
}
