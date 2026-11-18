/**
 * Builds the cockpit shell, the zone panels, the label panels and every control owned by Task 8.
 * Positions come from LAYOUT/ZONES (layout.ts); colours and sizes from THEME. The route cells and the PA
 * button are canvas-panel hit pads built by Task 10 (src/xr/panels), not controls from this file.
 */
import {
  BoxGeometry,
  Color,
  Euler,
  ExtrudeGeometry,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PanelUI,
  Shape,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { THEME } from '../theme';
import { LabelPanel, DevActionLog } from '../controls/components';
import type { CockpitControl } from '../controls/controlBase';
import { createPushButton } from '../controls/pushButton';
import { createStepperKnob } from '../controls/stepperKnob';
import { createToggle } from '../controls/toggleSwitch';
import { createOptionSelector } from '../controls/optionSelector';
import { HEAD_ANCHOR, LOCAL, ZONES, type ZoneKey } from './layout';
import { mergeBoxes, mergeColored, type BoxSpec } from './mergeBoxes';
import { createDisplayGlow } from './glow';

const FACE_DEPTH = 0.012;
const EDGE_STRIP = 0.003;
const BEZEL_MARGIN = 0.012;
/** UIKitML label panels sit just in front of the proud control caps. */
const LABEL_Z = 0.0135;

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function faceGeometry(w: number, h: number, r: number, depth: number): ExtrudeGeometry {
  return new ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: false, curveSegments: 3 });
}

const lambert = (hex: string) => new MeshLambertMaterial({ color: new Color(hex) });

/** Zone panels that only hold a label document (the rest are blank placeholders for Tasks 9 and 10). */
const LABEL_PANELS: Partial<Record<ZoneKey, string>> = {
  overhead: '/ui/overhead-labels.uikitml',
  autopilot: '/ui/autopilot-labels.uikitml',
  kneeboard: '/ui/kneeboard-labels.uikitml',
};

/** Zones whose face Task 9 redraws (displays): the face stays a separate simple mesh. */
const DISPLAY_ZONES: ReadonlySet<ZoneKey> = new Set<ZoneKey>(['pfd', 'nd', 'alerts']);

interface Backing {
  parts: Array<{ geometry: ExtrudeGeometry | BoxGeometry; color: Color }>;
}

/** Zone root (empty frame that controls parent to) + static backing parts queued for ONE merged mesh. */
function addZone(world: World, key: ZoneKey, backing: Backing, faceMat: MeshLambertMaterial): Entity {
  const z = ZONES[key];
  const root = new Object3D();
  root.name = `zone:${key}`;
  root.position.set(HEAD_ANCHOR[0] + z.pos[0], HEAD_ANCHOR[1] + z.pos[1], HEAD_ANCHOR[2] + z.pos[2]);
  root.rotation.copy(new Euler(z.rotX ?? 0, z.rotY ?? 0, 0, 'YXZ'));
  root.updateMatrix();
  const [w, h] = z.size;

  const bake = (g: ExtrudeGeometry | BoxGeometry, x: number, y: number, zz: number, hex: string) => {
    g.translate(x, y, zz);
    g.applyMatrix4(root.matrix);
    backing.parts.push({ geometry: g, color: new Color(hex) });
  };
  bake(faceGeometry(w + 2 * BEZEL_MARGIN, h + 2 * BEZEL_MARGIN, 0.01, 0.006), 0, 0, -0.008, THEME.color.bezel);
  bake(new BoxGeometry(w - 0.016, EDGE_STRIP, 0.0012), 0, h / 2 - EDGE_STRIP / 2 - 0.002, 0.0006, THEME.color.panelEdge);
  const entity = world.createTransformEntity(root);
  if (DISPLAY_ZONES.has(key)) {
    const face = new Mesh(faceGeometry(w, h, 0.008, FACE_DEPTH), faceMat);
    face.name = `face:${key}`;
    face.position.z = -FACE_DEPTH + 0.0005;
    root.add(face);
  } else {
    bake(faceGeometry(w, h, 0.008, FACE_DEPTH), 0, 0, -FACE_DEPTH + 0.0005, THEME.color.panel);
  }

  const cfg = LABEL_PANELS[key];
  if (cfg) {
    const doc = world.createTransformEntity(new Object3D(), entity);
    doc.object3D!.name = `labels:${key}`;
    doc.object3D!.position.set(0, 0, LABEL_Z);
    doc.addComponent(PanelUI, { config: cfg });
    doc.addComponent(LabelPanel, { key });
  }
  return entity;
}

function addShell(world: World): void {
  // Cockpit walls in `bezel`: a windscreen opening in the front wall, side/roof/floor/back so the
  // player never sees past the cabin. All boxes are merged into ONE mesh (one draw call).
  const [ax, ay, az] = HEAD_ANCHOR;
  const zf = -0.95; // front wall plane
  const boxes: BoxSpec[] = [
    { size: [2.2, 0.9, 0.05], center: [0, -0.55, zf] }, // front-bottom (opening starts at y -0.1)
    { size: [2.2, 0.5, 0.05], center: [0, 0.65, zf] }, // front-top
    { size: [0.55, 0.5, 0.05], center: [-0.875, 0.15, zf] }, // front-left
    { size: [0.55, 0.5, 0.05], center: [0.875, 0.15, zf] }, // front-right
    { size: [0.05, 0.5, 0.05], center: [0, 0.15, zf] }, // centre post
    { size: [0.05, 2, 2.2], center: [-1.1, 0, -0.1] }, // left
    { size: [0.05, 2, 2.2], center: [1.1, 0, -0.1] }, // right
    { size: [2.2, 0.05, 2.2], center: [0, 0.9, -0.1] }, // roof
    { size: [2.2, 0.05, 2.2], center: [0, -1.0, -0.1] }, // floor
    { size: [2.2, 2, 0.05], center: [0, 0, 1.0] }, // back
  ];
  const shell = new Mesh(mergeBoxes(boxes), lambert(THEME.color.bezel));
  shell.name = 'shell';
  shell.position.set(ax, ay, az);
  world.createTransformEntity(shell);
}

/** Zone panel entities by key (filled by buildCockpit): Task 9/10 parent their controls and display quads to these. */
export const builtZoneEntities: Partial<Record<ZoneKey, Entity>> = {};

export function buildCockpit(world: World, bus: EventBus): Map<ControlId, CockpitControl> {
  const controls = new Map<ControlId, CockpitControl>();
  const faceMat = lambert(THEME.color.panel);
  const backing: Backing = { parts: [] };

  addShell(world);
  const zoneEntities = builtZoneEntities as Record<ZoneKey, Entity>;
  for (const key of Object.keys(ZONES) as ZoneKey[]) zoneEntities[key] = addZone(world, key, backing, faceMat);
  // One mesh (one draw call) for every static zone bezel, face and edge strip: vertex-coloured Lambert, world space.
  const backingMesh = new Mesh(mergeColored(backing.parts), new MeshLambertMaterial({ vertexColors: true }));
  backingMesh.name = 'zones-backing';
  world.createTransformEntity(backingMesh);
  for (const p of backing.parts) p.geometry.dispose();
  // Night direction: the three displays spill a soft glow onto the dark cockpit (one additive mesh, one draw call).
  const glow = createDisplayGlow([...DISPLAY_ZONES].map((key) => ({ matrix: zoneEntities[key].object3D!.matrix, size: ZONES[key].size })));
  world.createTransformEntity(glow);

  const ap = { world, parent: zoneEntities.autopilot, labelPanel: 'autopilot' };
  const ov = { world, parent: zoneEntities.overhead, labelPanel: 'overhead' };
  const kb = { world, parent: zoneEntities.kneeboard, labelPanel: 'kneeboard' };
  const add = (c: CockpitControl) => controls.set(c.id, c);

  const pad3 = (v: number) => String(Math.round(v)).padStart(3, '0');
  add(createStepperKnob('ap.hdg', { ...ap, local: LOCAL['ap.hdg'], step: 10, min: 0, max: 359, wrap: true, initial: 270, format: pad3, padDiameter: 0.038, padOffset: 0.056 }, bus));
  add(createStepperKnob('ap.alt', { ...ap, local: LOCAL['ap.alt'], step: 1000, min: 0, max: 41000, initial: 10000, padDiameter: 0.038, padOffset: 0.056 }, bus));
  add(createStepperKnob('baro.set', { ...ap, local: LOCAL['baro.set'], step: 1, min: 950, max: 1050, initial: 1013, padDiameter: 0.038, padOffset: 0.056 }, bus));
  add(createPushButton('ap.engage', { ...ap, local: LOCAL['ap.engage'], size: [0.048, 0.042] }, bus));
  add(createOptionSelector('ap.lateral', { ...ap, local: LOCAL['ap.lateral'], options: ['hdg', 'nav'], initial: 'hdg', padSize: [0.036, 0.042], pitch: 0.052 }, bus));
  add(createOptionSelector('ap.vertical', { ...ap, local: LOCAL['ap.vertical'], options: ['climb', 'hold'], initial: 'climb', padSize: [0.036, 0.042], pitch: 0.052 }, bus));

  add(createToggle('elec.gen1', { ...ov, local: LOCAL['elec.gen1'], initial: true }, bus));
  add(createToggle('elec.gen2', { ...ov, local: LOCAL['elec.gen2'], initial: true }, bus));
  add(createToggle('elec.busTie', { ...ov, local: LOCAL['elec.busTie'], initial: false, guarded: true }, bus));
  add(createToggle('lights.landing', { ...ov, local: LOCAL['lights.landing'], initial: false }, bus));
  add(createToggle('lights.strobe', { ...ov, local: LOCAL['lights.strobe'], initial: false }, bus));
  add(createToggle('practice.toggle', { ...kb, local: LOCAL['practice.toggle'], initial: false, base: [0.12, 0.045], trainer: true }, bus));

  if (import.meta.env.MODE !== 'production') installDevHooks(world, bus, controls);
  return controls;
}

interface TrainerHook {
  controlPosition(id: string, part?: string): [number, number, number];
  /** Last frame's draw calls / triangles (renderer.info), for the performance budget. */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number };
  actions: unknown[];
}

/** Dev only: window.__trainer.controlPosition(id[, part]) and an ECS-readable action counter. */
function installDevHooks(world: World, bus: EventBus, controls: Map<ControlId, CockpitControl>): void {
  const logObj = new Object3D();
  logObj.name = 'dev-action-log';
  const logEntity = world.createTransformEntity(logObj);
  logEntity.addComponent(DevActionLog, { count: 0, last: '' });
  const actions: unknown[] = [];
  bus.onAction((a) => {
    actions.push(a);
    logEntity.setValue(DevActionLog, 'count', actions.length);
    logEntity.setValue(DevActionLog, 'last', JSON.stringify(a));
  });
  const g = globalThis as unknown as { __trainer?: Partial<TrainerHook> };
  g.__trainer = {
    ...g.__trainer,
    actions,
    renderInfo() {
      const i = world.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
    },
    controlPosition(id: string, part?: string) {
      const c = controls.get(id as ControlId);
      if (!c) throw new Error(`unknown control '${id}'`);
      const v = (part !== undefined && c.partPosition?.(part)) || c.worldPosition();
      return [v.x, v.y, v.z];
    },
  };
}
