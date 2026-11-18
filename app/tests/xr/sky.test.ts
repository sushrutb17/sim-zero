import { describe, expect, it } from 'vitest';
import { CLIMB_OUT_S, cloudTileOffsets, nextAirborneLevel, outsidePose, paintClouds, type CloudContext } from '../../src/xr/outside/sky';

const SIZE = 1024;
const intersects = (x: number, y: number, r: number, ox: number, oy: number) =>
  x + ox + r > 0 && x + ox - r < SIZE && y + oy + r > 0 && y + oy - r < SIZE;

describe('cloudTileOffsets', () => {
  it('keeps only the middle tile for a blob well inside the canvas', () => {
    expect(cloudTileOffsets(500, 500, 100)).toEqual([[0, 0]]);
  });

  it('adds the wrapped copies for a blob that overlaps an edge or a corner', () => {
    expect(cloudTileOffsets(30, 500, 100)).toEqual([[0, 0], [1024, 0]]);
    expect(cloudTileOffsets(990, 1000, 100)).toEqual([[-1024, -1024], [-1024, 0], [0, -1024], [0, 0]]);
    expect(cloudTileOffsets(10, 10, 50)).toHaveLength(4);
  });

  it('treats a square that only touches the edge as off-canvas', () => {
    expect(cloudTileOffsets(1024 + 100, 500, 100)).not.toContainEqual([0, 0]);
    expect(cloudTileOffsets(100, 500, 100)).not.toContainEqual([1024, 0]); // its wrapped copy only touches x = 1024
    expect(cloudTileOffsets(99.5, 500, 100)).toContainEqual([1024, 0]);
  });

  it('matches a brute-force intersection test over a sweep of positions and radii', () => {
    for (let x = 0; x < SIZE; x += 37) for (let y = 0; y < SIZE; y += 41) for (const r of [40, 95, 150]) {
      const expected: Array<[number, number]> = [];
      for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) if (intersects(x, y, r, ox, oy)) expected.push([ox, oy]);
      expect(cloudTileOffsets(x, y, r)).toEqual(expected);
    }
  });
});

describe('paintClouds', () => {
  const fake = () => {
    const rects: Array<[number, number, number, number]> = [];
    const gradients: number[][] = [];
    const g: CloudContext = {
      clearRect: () => {},
      createRadialGradient: (...a: number[]) => { gradients.push(a); return { addColorStop: () => {} }; },
      fillStyle: null,
      fillRect: (x, y, w, h) => { rects.push([x, y, w, h]); },
    };
    return { g, rects, gradients };
  };

  it('fills far fewer tiles than the 9 per blob (1350 before), every one touching the canvas', () => {
    const { g, rects } = fake();
    paintClouds(g);
    expect(rects.length).toBeGreaterThanOrEqual(150); // each of the 150 blobs has its middle tile
    expect(rects.length).toBeLessThan(250); // 213 today
    for (const [x, y, w, h] of rects) {
      expect(x + w).toBeGreaterThan(0);
      expect(x).toBeLessThan(SIZE);
      expect(y + h).toBeGreaterThan(0);
      expect(y).toBeLessThan(SIZE);
    }
  });

  it('is deterministic and gives each fill its own gradient', () => {
    const a = fake();
    const b = fake();
    paintClouds(a.g);
    paintClouds(b.g);
    expect(a.rects).toEqual(b.rects);
    expect(a.gradients.length).toBe(a.rects.length);
  });
});

// ---- T37: the outside view leaves the runway behind after takeoff ----
describe('outsidePose', () => {
  const EYE_Y = 1.2;
  const FOG_FAR = 185;

  it('is the unchanged ground picture at level 0', () => {
    expect(outsidePose(0)).toEqual({ groundY: -2, runwayZ: -100, groundVisible: true, cloudY: [38, 70] });
  });

  it('ends with the ground hidden past the fog and both cloud layers below the eye, tops nearest', () => {
    const p = outsidePose(1);
    expect(p.groundVisible).toBe(false);
    expect(EYE_Y - p.groundY).toBeGreaterThan(FOG_FAR); // fully fogged before it stops being drawn: no pop
    expect(p.cloudY[1]).toBeLessThan(EYE_Y - 3); // clear of the cockpit
    expect(p.cloudY[1]).toBeGreaterThan(EYE_Y - 15); // near enough to show as a deck low in the windscreen before the fog takes it
    expect(p.cloudY[0]).toBeLessThan(p.cloudY[1]); // the lighter "tops" layer stays the upper one
  });

  it('moves one way only: the ground and clouds never come back up during the climb-out', () => {
    let prev = outsidePose(0);
    for (let i = 1; i <= 100; i++) {
      const p = outsidePose(i / 100);
      expect(p.groundY).toBeLessThan(prev.groundY);
      expect(p.runwayZ).toBeGreaterThan(prev.runwayZ);
      expect(p.cloudY[0]).toBeLessThanOrEqual(prev.cloudY[0]);
      expect(p.cloudY[1]).toBeLessThanOrEqual(prev.cloudY[1]);
      expect(p.groundVisible).toBe(i < 100);
      prev = p;
    }
  });

  it('has the runway behind the nose within the first half of the climb-out', () => {
    // the strip is 170 m long, so its far end is 85 m ahead of its centre
    expect(outsidePose(0.5).runwayZ - 85).toBeGreaterThan(-40);
  });

  it('clamps the level and can write into a reused object', () => {
    expect(outsidePose(-3)).toEqual(outsidePose(0));
    expect(outsidePose(7)).toEqual(outsidePose(1));
    const out = outsidePose(0);
    expect(outsidePose(0.4, out)).toBe(out);
    expect(out).toEqual(outsidePose(0.4));
  });
});

describe('nextAirborneLevel', () => {
  it('stays at 0 on the ground and reaches 1 after CLIMB_OUT_S in the air', () => {
    expect(nextAirborneLevel(0, false, 1)).toBe(0);
    let level = 0;
    for (let t = 0; t < CLIMB_OUT_S * 72 + 5; t++) level = nextAirborneLevel(level, true, 1 / 72);
    expect(level).toBe(1);
    expect(nextAirborneLevel(0, true, CLIMB_OUT_S / 2)).toBeCloseTo(0.5, 9);
  });

  it('snaps back to the ground picture on a reset and ignores a negative frame time', () => {
    expect(nextAirborneLevel(0.7, false, 1 / 72)).toBe(0);
    expect(nextAirborneLevel(1, false, 0)).toBe(0);
    expect(nextAirborneLevel(0.3, true, -1)).toBe(0.3);
  });
});
