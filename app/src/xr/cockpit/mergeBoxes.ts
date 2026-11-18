import { BoxGeometry, BufferGeometry, Float32BufferAttribute, type Color } from '@iwsdk/core';

export interface BoxSpec {
  size: readonly [number, number, number];
  center: readonly [number, number, number];
}

/** Merge axis-aligned boxes into ONE non-indexed geometry (one draw call instead of N). */
export function mergeBoxes(boxes: readonly BoxSpec[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const b of boxes) {
    const g = new BoxGeometry(b.size[0], b.size[1], b.size[2]).toNonIndexed();
    g.translate(b.center[0], b.center[1], b.center[2]);
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return out;
}

/** Bake geometries (already in their final space) into one non-indexed, vertex-coloured geometry. */
export function mergeColored(parts: ReadonlyArray<{ geometry: BufferGeometry; color: Color }>): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const { geometry, color } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal.array as Float32Array;
    for (let i = 0; i < p.length; i++) {
      pos.push(p[i]);
      nor.push(n[i]);
    }
    for (let i = 0; i < p.length / 3; i++) col.push(color.r, color.g, color.b);
    if (g !== geometry) g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  return out;
}
