/** A flat self-lit quad textured from a 2D canvas. Redraws at most 10 Hz and only when marked dirty. */
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { RedrawGate } from './redrawGate';

export interface CanvasPanel {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  markDirty(): void;
  /** Install the draw function; it runs on the next due tick. */
  setDraw(fn: (ctx: CanvasRenderingContext2D) => void): void;
  /** Call every frame with a ms clock. Returns true when it redrew. */
  tick(nowMs: number): boolean;
}

/** `w`, `h` in metres; `pxPerM` canvas pixels per metre (see drawUtil.ts for the chosen value and why). */
export function createCanvasPanel(w: number, h: number, pxPerM: number): CanvasPanel {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * pxPerM);
  canvas.height = Math.round(h * pxPerM);
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  const gate = new RedrawGate(100);
  let draw: ((c: CanvasRenderingContext2D) => void) | undefined;
  return {
    mesh,
    ctx,
    markDirty: () => gate.markDirty(),
    setDraw: (fn) => {
      draw = fn;
      gate.markDirty();
    },
    tick(nowMs) {
      if (!draw || !gate.shouldRedraw(nowMs)) return false;
      draw(ctx);
      texture.needsUpdate = true;
      return true;
    },
  };
}
