/**
 * Display glow (T21, night direction): the light a self-lit display spills onto the dark cockpit around it.
 * One additive mesh for all displays (one draw call), a 128 px code-generated falloff texture, no bloom.
 * Each quad sits just behind its display's bezel plate, so only the part outside the bezel is visible.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Matrix4,
} from '@iwsdk/core';
import { THEME } from '../theme';

/** How far the glow reaches beyond the display face on each side, in metres. */
export const GLOW_REACH_M = 0.07;
/** Behind the bezel plate (which spans z -0.008 .. -0.002 in the zone frame). */
const GLOW_Z = -0.013;

/** Alpha (0..1) of the glow at normalised radius r (0 = centre, 1 = quad edge): flat core, smooth fade to zero. */
export function glowAlpha(r: number): number {
  if (r <= 0.3) return 1;
  if (r >= 1) return 0;
  const t = (1 - r) / 0.7;
  return t * t * (3 - 2 * t);
}

function glowTexture(): CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / (N / 2) - 1;
    const dy = (y + 0.5) / (N / 2) - 1;
    const v = Math.round(255 * glowAlpha(Math.hypot(dx, dy)));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; // additive: brightness is the mask
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new CanvasTexture(c);
}

/** `frames`: each display's zone matrix (world space) and face size [w, h] in metres. */
export function createDisplayGlow(frames: ReadonlyArray<{ matrix: Matrix4; size: readonly [number, number] }>): Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const { matrix, size } of frames) {
    const plane = new PlaneGeometry(size[0] + 2 * GLOW_REACH_M, size[1] + 2 * GLOW_REACH_M);
    plane.translate(0, 0, GLOW_Z);
    plane.applyMatrix4(matrix);
    const g = plane.toNonIndexed();
    pos.push(...(g.attributes.position.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
    g.dispose();
    plane.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const material = new MeshBasicMaterial({
    map: glowTexture(),
    color: new Color(THEME.display.glow).multiplyScalar(THEME.display.glowOpacity),
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'display-glow';
  mesh.renderOrder = -1; // before other transparent surfaces (labels, panels)
  return mesh;
}
