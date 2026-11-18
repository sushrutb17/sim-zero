/**
 * Guided-flight frames: a fixed pool of MAX_FRAMES meshes (one draw call each) that outline the front face of a pad
 * in THEME accent and pulse. Each frame follows its pad's world matrix every tick without allocating, and rewrites its
 * bar geometry only when the pad's size changes. The pad is looked up by mesh name in the shared pad registry.
 */
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type World } from '@iwsdk/core';
import { pads, type PadRuntime } from '../controls/controlBase';
import { THEME } from '../theme';
import { MAX_FRAMES } from './resolve';

const BAR_M = 0.0045; // 3 mm read as a faint hairline on the dark panels in the emulator capture (T24 Task 8)
const OUTSET_M = 0.002;
const FRONT_M = 0.002;
const PULSE_MS = 1000;
const OPACITY_MIN = 0.55;
const OPACITY_MAX = 1.0;
const RENDER_ORDER = 10; // above the canvas panels (0) and the glow (-1)
const HIDDEN_LOCAL_Z = -1; // panel pads are parked at z = -5 when hidden

export interface GuideFrames {
  show(padNames: readonly string[]): void;
  tick(nowMs: number): void;
  /** Dev/test: the pad names currently framed (allocates). */
  framedNames(): string[];
  /** Dev/test: the n-th pad currently framed. */
  framedPad(n: number): PadRuntime | undefined;
}

interface Slot {
  mesh: Mesh;
  positions: BufferAttribute;
  name: string;
  pad: PadRuntime | undefined;
  w: number;
  h: number;
}

const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15]);

function padHidden(pad: PadRuntime): boolean {
  if (pad.mesh.position.z < HIDDEN_LOCAL_Z) return true;
  return pad.controlId.startsWith('panel:') && !pad.enabled;
}

/** Write four bars (top, bottom, left, right) around a w x h rectangle centred on the origin. */
function writeBars(a: BufferAttribute, w: number, h: number): void {
  const ix = w / 2 + OUTSET_M;
  const iy = h / 2 + OUTSET_M;
  const ox = ix + BAR_M;
  const oy = iy + BAR_M;
  const rect = (i: number, x0: number, y0: number, x1: number, y1: number): void => {
    a.setXYZ(i * 4, x0, y0, 0);
    a.setXYZ(i * 4 + 1, x1, y0, 0);
    a.setXYZ(i * 4 + 2, x1, y1, 0);
    a.setXYZ(i * 4 + 3, x0, y1, 0);
  };
  rect(0, -ox, iy, ox, oy);
  rect(1, -ox, -oy, ox, -iy);
  rect(2, -ox, -iy, -ix, iy);
  rect(3, ix, -iy, ox, iy);
  a.needsUpdate = true;
}

export function createGuideFrames(world: World): GuideFrames {
  const material = new MeshBasicMaterial({ color: THEME.color.accent, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
  const slots: Slot[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    const geometry = new BufferGeometry();
    const positions = new BufferAttribute(new Float32Array(16 * 3), 3);
    geometry.setAttribute('position', positions);
    geometry.setIndex(new BufferAttribute(QUAD_INDEX, 1));
    const mesh = new Mesh(geometry, material);
    mesh.name = `guide:frame:${i}`;
    mesh.renderOrder = RENDER_ORDER;
    mesh.frustumCulled = false;
    mesh.visible = false;
    world.createTransformEntity(mesh);
    slots.push({ mesh, positions, name: '', pad: undefined, w: -1, h: -1 });
  }

  const byName = new Map<string, PadRuntime>();
  let mapped = -1;
  const lookup = (name: string): PadRuntime | undefined => {
    if (mapped !== pads.length) {
      byName.clear();
      for (const p of pads) byName.set(p.mesh.name, p);
      mapped = pads.length;
    }
    return byName.get(name);
  };

  const pos = new Vector3();
  const off = new Vector3();
  const sizeScale = new Vector3();
  const quat = new Quaternion();

  return {
    show(names) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        s.name = i < names.length ? names[i] : '';
        s.pad = s.name ? lookup(s.name) : undefined;
        if (!s.pad) s.mesh.visible = false;
      }
    },
    tick(nowMs) {
      const phase = (nowMs % PULSE_MS) / PULSE_MS;
      material.opacity = OPACITY_MIN + ((OPACITY_MAX - OPACITY_MIN) * (1 + Math.cos(phase * 2 * Math.PI))) / 2;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const pad = s.pad;
        if (!pad || padHidden(pad)) {
          s.mesh.visible = false;
          continue;
        }
        const mesh = pad.mesh;
        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        mesh.updateWorldMatrix(true, false);
        mesh.matrixWorld.decompose(pos, quat, sizeScale);
        const sx = mesh.scale.x;
        const sy = mesh.scale.y;
        const w = (bb.max.x - bb.min.x) * sx;
        const h = (bb.max.y - bb.min.y) * sy;
        if (w !== s.w || h !== s.h) {
          s.w = w;
          s.h = h;
          writeBars(s.positions, w, h);
        }
        // Centre of the front face, in the pad's own frame, pushed FRONT_M proud of it.
        off.set(((bb.max.x + bb.min.x) / 2) * sx, ((bb.max.y + bb.min.y) / 2) * sy, bb.max.z * mesh.scale.z + FRONT_M).applyQuaternion(quat);
        s.mesh.position.copy(pos).add(off);
        s.mesh.quaternion.copy(quat);
        s.mesh.visible = true;
      }
    },
    framedNames() {
      return slots.filter((s) => s.mesh.visible).map((s) => s.name);
    },
    framedPad(n) {
      return slots.filter((s) => s.mesh.visible)[n]?.pad;
    },
  };
}
