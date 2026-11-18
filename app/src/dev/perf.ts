/**
 * Dev-only performance probe (Task 16): fps, draw calls, triangles and texture sizes, for the Global performance
 * budget (60 fps target on Quest Browser, <=150 draw calls, <=150k triangles, textures <=2048^2).
 *
 * Installed only when `import.meta.env.MODE !== 'production'` (see installDevHooks in index.ts), so none of it
 * ships. EMULATOR numbers (IWER, desktop GPU) say nothing about real Quest frame rate; draw calls and triangles
 * are renderer-side counts and do carry over.
 *
 * Frames are counted from the world's own frame loop (AppFlowSystem's per-frame callback), because
 * `window.requestAnimationFrame` does not fire while an immersive XR session is active.
 */
import type { Object3D, World } from '@iwsdk/core';

export interface PerfSample {
  /** Frames per second over a rolling ~1 s window (0 until two frames are seen, or when frames stopped). */
  fps: number;
  /** Draw calls of the last rendered frame (renderer.info.render.calls; in XR both eyes are counted). */
  calls: number;
  /** Triangles of the last rendered frame (renderer.info.render.triangles). */
  triangles: number;
  /** Unique textures referenced by the scene's materials (and background / environment). */
  textures: number;
  /** Largest width or height among those textures, in pixels. */
  maxTextureSize: number;
}

/** Rolling frame-rate window: push one timestamp (ms) per frame, read the rate at any time. */
export class FpsWindow {
  private stamps: number[] = [];
  constructor(private readonly windowMs = 1000) {}

  push(nowMs: number): void {
    this.stamps.push(nowMs);
    this.trim(nowMs);
  }

  fps(nowMs: number): number {
    this.trim(nowMs);
    const n = this.stamps.length;
    if (n < 2) return 0;
    const span = this.stamps[n - 1] - this.stamps[0];
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    let drop = 0;
    while (drop < this.stamps.length && this.stamps[drop] < cutoff) drop++;
    if (drop > 0) this.stamps.splice(0, drop);
  }
}

interface ImageLike {
  width?: number;
  height?: number;
  videoWidth?: number;
  videoHeight?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}
interface TextureLike {
  isTexture?: boolean;
  image?: unknown;
  mipmaps?: unknown;
}

/** Largest width/height of one texture (cube maps and compressed mip chains included); 0 if unknown. */
export function textureSize(tex: TextureLike): number {
  const images = (Array.isArray(tex.image) ? [...tex.image] : [tex.image]) as (ImageLike | null | undefined)[];
  if (Array.isArray(tex.mipmaps) && tex.mipmaps.length > 0) images.push(tex.mipmaps[0] as ImageLike);
  let max = 0;
  for (const im of images) {
    if (!im) continue;
    const w = im.width || im.videoWidth || im.naturalWidth || 0;
    const h = im.height || im.videoHeight || im.naturalHeight || 0;
    max = Math.max(max, w, h);
  }
  return max;
}

const isTexture = (v: unknown): v is TextureLike => typeof v === 'object' && v !== null && (v as TextureLike).isTexture === true;

/**
 * Walks an object tree and returns the unique textures held by mesh/sprite/line materials (any material property
 * that is a Texture, plus shader-uniform textures), and the largest side among them. Canvas textures count.
 * `extra` adds textures that are not on a material (scene.background / scene.environment).
 */
export function scanTextures(root: Object3D, extra: unknown[] = []): { count: number; maxSize: number } {
  const seen = new Set<TextureLike>();
  const add = (v: unknown): void => {
    if (isTexture(v)) seen.add(v);
  };
  for (const e of extra) add(e);
  root.traverse((obj) => {
    const mat = (obj as unknown as { material?: unknown }).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (typeof m !== 'object' || m === null) continue;
      for (const v of Object.values(m)) add(v);
      const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) add(u?.value);
    }
  });
  let maxSize = 0;
  for (const t of seen) maxSize = Math.max(maxSize, textureSize(t));
  return { count: seen.size, maxSize };
}

export interface Perf {
  /** Call once per frame from the world's frame loop. Also refreshes the overlay about twice a second. */
  frame(nowMs: number): void;
  sample(): PerfSample;
}

/** Builds the probe and exposes `window.__trainer.perf()`; `?perf=1` adds the on-screen overlay. */
export function installPerf(world: World): Perf {
  const win = new FpsWindow(1000);
  const sample = (): PerfSample => {
    const info = world.renderer.info.render;
    const scene = world.scene as unknown as Object3D & { background?: unknown; environment?: unknown };
    const tex = scanTextures(scene, [scene.background, scene.environment]);
    return { fps: win.fps(performance.now()), calls: info.calls, triangles: info.triangles, textures: tex.count, maxTextureSize: tex.maxSize };
  };
  const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
  g.__trainer = { ...g.__trainer, perf: sample };

  let overlay: HTMLDivElement | undefined;
  if (new URLSearchParams(location.search).get('perf') === '1') {
    // A DOM overlay shows on the desktop / IWER view only; it is not visible inside a headset.
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99999;padding:4px 6px;background:rgba(0,0,0,.65);color:#7CFC9A;font:12px/1.3 monospace;white-space:pre;pointer-events:none';
    document.body.appendChild(overlay);
  }
  let lastPaint = 0;
  return {
    frame(nowMs) {
      win.push(nowMs);
      if (!overlay || nowMs - lastPaint < 500) return;
      lastPaint = nowMs;
      const s = sample();
      overlay.textContent = `fps ${s.fps.toFixed(0)}\ncalls ${s.calls}\ntris ${s.triangles}\ntex ${s.textures} (max ${s.maxTextureSize}px)`;
    },
    sample,
  };
}
