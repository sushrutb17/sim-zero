// T37: seat anchoring. The rig transform must put the tracked head on the anchor, facing the cockpit (-Z).
import { describe, expect, it } from 'vitest';
import { SEAT_DEFAULT_M, SEAT_MAX_M, SEAT_MIN_M, SEAT_STEP_M, clampSeat, headYaw, seatLabel, seatTransform, stepSeat, type Quat, type Vec3 } from '../../src/xr/seatMath';
import { HEAD_ANCHOR } from '../../src/xr/cockpit/layout';

const DEG = Math.PI / 180;

/** Quaternion for intrinsic yaw (about Y), then pitch (about X), then roll (about Z): the order a head turns in. */
function headQuat(yawDeg: number, pitchDeg = 0, rollDeg = 0): Quat {
  const mul = (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const axis = (x: number, y: number, z: number, deg: number): Quat => {
    const h = (deg * DEG) / 2;
    return [x * Math.sin(h), y * Math.sin(h), z * Math.sin(h), Math.cos(h)];
  };
  return mul(mul(axis(0, 1, 0, yawDeg), axis(1, 0, 0, pitchDeg)), axis(0, 0, 1, rollDeg));
}
const rotate = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const rotY = (a: number, v: Vec3): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
/** Where the rig transform puts a rig-local point / direction. */
const toWorld = (pose: { x: number; y: number; z: number; yaw: number }, p: Vec3): Vec3 => {
  const r = rotY(pose.yaw, p);
  return [r[0] + pose.x, r[1] + pose.y, r[2] + pose.z];
};

describe('headYaw', () => {
  it('reads the heading and ignores pitch and roll', () => {
    expect(headYaw(headQuat(0))).toBeCloseTo(0, 9);
    expect(headYaw(headQuat(90))).toBeCloseTo(90 * DEG, 9);
    expect(headYaw(headQuat(-135))).toBeCloseTo(-135 * DEG, 9);
    expect(headYaw(headQuat(40, -20))).toBeCloseTo(40 * DEG, 9);
    expect(headYaw(headQuat(40, 35))).toBeCloseTo(40 * DEG, 9);
    expect(headYaw(headQuat(-60, -30, 0))).toBeCloseTo(-60 * DEG, 9);
  });

  it('still gives the heading when the gaze is almost straight down or up', () => {
    expect(headYaw(headQuat(25, -88))).toBeCloseTo(25 * DEG, 6);
    expect(headYaw(headQuat(25, -90))).toBeCloseTo(25 * DEG, 6);
    expect(headYaw(headQuat(-70, 89))).toBeCloseTo(-70 * DEG, 6);
  });
});

describe('seatTransform', () => {
  const cases: Array<{ name: string; pos: Vec3; yaw: number; pitch: number }> = [
    { name: 'already on the anchor', pos: [0, 1.2, 0], yaw: 0, pitch: -20 },
    { name: 'standing, a step back and to the side', pos: [0.6, 1.68, 1.1], yaw: 0, pitch: 0 },
    { name: 'low chair, far corner of the room, turned left', pos: [-1.8, 1.02, -2.4], yaw: 110, pitch: -10 },
    { name: 'turned right around', pos: [0.3, 1.3, 0.2], yaw: 180, pitch: 5 },
    { name: 'floor-less tracking space (head near the origin)', pos: [0.01, -0.02, 0.03], yaw: -45, pitch: 0 },
  ];

  for (const c of cases) {
    it(`puts the head on the anchor, looking down -Z: ${c.name}`, () => {
      const q = headQuat(c.yaw, c.pitch);
      const pose = seatTransform(c.pos, q, HEAD_ANCHOR);
      const head = toWorld(pose, c.pos);
      expect(head[0]).toBeCloseTo(HEAD_ANCHOR[0], 9);
      expect(head[1]).toBeCloseTo(HEAD_ANCHOR[1], 9);
      expect(head[2]).toBeCloseTo(HEAD_ANCHOR[2], 9);
      // gaze direction in the world: heading removed, pitch kept
      const gaze = rotY(pose.yaw, rotate(q, [0, 0, -1]));
      expect(gaze[0]).toBeCloseTo(0, 9);
      expect(gaze[2]).toBeLessThan(0);
      expect(gaze[1]).toBeCloseTo(Math.sin(c.pitch * DEG), 9);
    });
  }

  it('keeps things beside the user beside them: a hand 30 cm to the right of the head stays 30 cm to the right', () => {
    const pos: Vec3 = [1, 1.5, -2];
    const q = headQuat(70);
    const right = rotate(q, [0.3, 0, 0]);
    const hand: Vec3 = [pos[0] + right[0], pos[1] + right[1], pos[2] + right[2]];
    const world = toWorld(seatTransform(pos, q, HEAD_ANCHOR), hand);
    expect(world[0]).toBeCloseTo(HEAD_ANCHOR[0] + 0.3, 9);
    expect(world[1]).toBeCloseTo(HEAD_ANCHOR[1], 9);
    expect(world[2]).toBeCloseTo(HEAD_ANCHOR[2], 9);
  });

  it('is the identity for the emulator pose the hands tests use, and can reuse an object', () => {
    const out = { x: 9, y: 9, z: 9, yaw: 9 };
    expect(seatTransform([0, 1.2, 0], headQuat(0, -20), HEAD_ANCHOR, out)).toBe(out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
    expect(out.yaw).toBeCloseTo(0, 12);
  });
});

describe('seat offset (T40)', () => {
  it('has the agreed constants', () => {
    expect([SEAT_DEFAULT_M, SEAT_MIN_M, SEAT_MAX_M, SEAT_STEP_M]).toEqual([0.3, 0, 0.5, 0.05]);
  });

  it('clampSeat: default for non-finite, clamps to the range, snaps to the 0.05 grid', () => {
    for (const bad of [NaN, Infinity, -Infinity]) expect(clampSeat(bad)).toBe(SEAT_DEFAULT_M);
    expect(clampSeat(9)).toBe(0.5);
    expect(clampSeat(-1)).toBe(0);
    expect(clampSeat(0.12)).toBe(0.1);
    expect(clampSeat(0.13)).toBe(0.15);
    for (let i = 0; i <= 10; i++) expect(clampSeat((i * 5) / 100)).toBe((i * 5) / 100);
  });

  it('stepSeat: ten presses back from 0 end at 0.5, ten forward from 0.5 end at 0, with no creep at the limits', () => {
    let m = 0;
    for (let i = 0; i < 10; i++) m = stepSeat(m, 1);
    expect(m).toBe(0.5);
    expect(stepSeat(0.5, 1)).toBe(0.5);
    for (let i = 0; i < 10; i++) m = stepSeat(m, -1);
    expect(m).toBe(0);
    expect(stepSeat(0, -1)).toBe(0);
    expect(stepSeat(0.1, 1)).toBe(0.15);
    expect(stepSeat(0.1, -1)).toBe(0.05);
  });

  it('seatLabel reads like SEAT +10 cm, in printable ASCII', () => {
    expect(seatLabel(0.1)).toBe('SEAT +10 cm');
    expect(seatLabel(0)).toBe('SEAT +0 cm');
    expect(seatLabel(0.3)).toBe('SEAT +30 cm');
    expect(seatLabel(0.05)).toBe('SEAT +5 cm');
    expect(seatLabel(0.15)).toBe('SEAT +15 cm');
    expect(seatLabel(0.4)).toBe('SEAT +40 cm');
    expect(seatLabel(0.5)).toBe('SEAT +50 cm');
  });

  it('seatTransform with the anchor shifted back by the offset puts the head at [0, 1.2, 0.1]', () => {
    const anchor: Vec3 = [HEAD_ANCHOR[0], HEAD_ANCHOR[1], HEAD_ANCHOR[2] + 0.1];
    const pose = seatTransform([0, 1.2, 0], headQuat(0), anchor);
    const head = toWorld(pose, [0, 1.2, 0]);
    expect(head[0]).toBeCloseTo(0, 9);
    expect(head[1]).toBeCloseTo(1.2, 9);
    expect(head[2]).toBeCloseTo(0.1, 9);
  });
});
