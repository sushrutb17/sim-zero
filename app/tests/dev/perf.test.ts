import { describe, expect, it } from 'vitest';
import { CanvasTexture, DataTexture, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Scene, ShaderMaterial, Texture } from '@iwsdk/core';
import { FpsWindow, scanTextures, textureSize } from '../../src/dev/perf';

const img = (w: number, h: number) => ({ width: w, height: h });
const texOf = (w: number, h: number) => {
  const t = new Texture();
  t.image = img(w, h);
  return t;
};
const meshWith = (material: MeshBasicMaterial | ShaderMaterial | MeshBasicMaterial[]) => new Mesh(new PlaneGeometry(1, 1), material);

describe('FpsWindow', () => {
  it('is 0 with fewer than two frames', () => {
    const w = new FpsWindow();
    expect(w.fps(0)).toBe(0);
    w.push(0);
    expect(w.fps(0)).toBe(0);
  });

  it('reads 60 fps from 16.67 ms frames', () => {
    const w = new FpsWindow();
    for (let i = 0; i <= 90; i++) w.push((i * 1000) / 60);
    expect(w.fps(90_000 / 60)).toBeCloseTo(60, 5);
  });

  it('only counts frames inside the rolling window', () => {
    const w = new FpsWindow(1000);
    for (let i = 0; i < 50; i++) w.push(i * 100); // 10 fps for 5 s
    for (let i = 0; i <= 120; i++) w.push(5000 + i * 10); // then 100 fps
    expect(w.fps(6200)).toBeGreaterThan(95);
    expect(w.fps(6200)).toBeLessThan(105);
  });

  it('decays to 0 when frames stop', () => {
    const w = new FpsWindow(1000);
    for (let i = 0; i < 30; i++) w.push(i * 20);
    expect(w.fps(600)).toBeGreaterThan(0);
    expect(w.fps(5000)).toBe(0);
  });
});

describe('textureSize', () => {
  it('uses the larger side of image width/height', () => {
    expect(textureSize(texOf(512, 1024))).toBe(1024);
  });
  it('reads video and natural sizes', () => {
    expect(textureSize({ image: { videoWidth: 1280, videoHeight: 720 } })).toBe(1280);
    expect(textureSize({ image: { naturalWidth: 300, naturalHeight: 700 } })).toBe(700);
  });
  it('takes the max over cube faces and the first compressed mip', () => {
    expect(textureSize({ image: [img(256, 256), img(512, 512)] })).toBe(512);
    expect(textureSize({ image: null, mipmaps: [img(4096, 2048), img(2048, 1024)] })).toBe(4096);
  });
  it('is 0 when there is no image', () => {
    expect(textureSize({ image: null })).toBe(0);
    expect(textureSize({})).toBe(0);
  });
});

describe('scanTextures', () => {
  it('is empty for a scene with no textures', () => {
    const root = new Object3D();
    root.add(meshWith(new MeshBasicMaterial()));
    expect(scanTextures(root)).toEqual({ count: 0, maxSize: 0 });
  });

  it('finds map textures nested in the tree and reports the largest side', () => {
    const root = new Object3D();
    const group = new Object3D();
    root.add(group);
    group.add(meshWith(new MeshBasicMaterial({ map: texOf(256, 256) })));
    const deep = new Object3D();
    group.add(deep);
    deep.add(meshWith(new MeshBasicMaterial({ map: texOf(2048, 1024), alphaMap: texOf(64, 64) })));
    expect(scanTextures(root)).toEqual({ count: 3, maxSize: 2048 });
  });

  it('counts a texture shared by several materials once, and canvas textures', () => {
    const shared = texOf(512, 512);
    const canvas = { width: 1024, height: 768 } as unknown as HTMLCanvasElement;
    const root = new Object3D();
    root.add(meshWith(new MeshBasicMaterial({ map: shared })));
    root.add(meshWith(new MeshBasicMaterial({ map: shared })));
    root.add(meshWith(new MeshBasicMaterial({ map: new CanvasTexture(canvas) })));
    expect(scanTextures(root)).toEqual({ count: 2, maxSize: 1024 });
  });

  it('handles material arrays, shader uniforms and data textures', () => {
    const root = new Object3D();
    root.add(meshWith([new MeshBasicMaterial({ map: texOf(128, 128) }), new MeshBasicMaterial({ map: new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4) })]));
    root.add(meshWith(new ShaderMaterial({ uniforms: { u: { value: texOf(4096, 16) }, n: { value: 3 } } })));
    expect(scanTextures(root)).toEqual({ count: 3, maxSize: 4096 });
  });

  it('includes extra textures (scene background / environment) and ignores non-textures', () => {
    const scene = new Scene();
    expect(scanTextures(scene, [texOf(1024, 512), null, undefined, { width: 99999 }])).toEqual({ count: 1, maxSize: 1024 });
  });
});
