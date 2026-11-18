/**
 * Seat anchoring math (T37). The cockpit is built around HEAD_ANCHOR, a fixed point in the world, but a headset
 * reports the head wherever the user happens to be in their room, at their own height and heading. The player rig
 * (the parent of the tracked head, hands and camera) is therefore moved so that the tracked head lands on the anchor
 * looking down the cockpit's -Z axis.
 *
 * Pure: plain numbers in and out, no three or IWSDK imports, so vitest checks it in node.
 */

export type Vec3 = readonly [number, number, number];
/** Unit quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

export interface SeatPose {
  x: number;
  y: number;
  z: number;
  /** Rotation of the rig about +Y, radians. */
  yaw: number;
}

/** Below this horizontal length the gaze is within about 12 degrees of straight up or down: its heading is unreliable. */
const LEVEL_MIN = 0.2;

/**
 * Heading of the head about +Y (0 = looking down -Z, positive = turned left), ignoring pitch and roll.
 * When the gaze is nearly vertical the top of the head gives the heading instead: looking down it points forward,
 * looking up it points backward.
 */
export function headYaw(q: Quat): number {
  const [x, y, z, w] = q;
  // forward = q * (0, 0, -1)
  const fx = -2 * (x * z + w * y);
  const fy = -2 * (y * z - w * x);
  const fz = -(1 - 2 * (x * x + y * y));
  if (Math.hypot(fx, fz) >= LEVEL_MIN) return Math.atan2(-fx, -fz);
  // up = q * (0, 1, 0)
  const ux = 2 * (x * y - w * z);
  const uz = 2 * (y * z + w * x);
  const s = fy < 0 ? 1 : -1;
  return Math.atan2(-s * ux, -s * uz);
}

/**
 * Rig transform that puts a head tracked at `headPos` / `headQuat` (rig-local, i.e. the headset's own tracking space)
 * on `anchor`, facing -Z. Pass `out` to reuse an object.
 */
export function seatTransform(headPos: Vec3, headQuat: Quat, anchor: Vec3, out: SeatPose = { x: 0, y: 0, z: 0, yaw: 0 }): SeatPose {
  const yaw = -headYaw(headQuat);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // anchor - RotY(yaw) * headPos
  out.x = anchor[0] - (headPos[0] * c + headPos[2] * s);
  out.y = anchor[1] - headPos[1];
  out.z = anchor[2] - (-headPos[0] * s + headPos[2] * c);
  out.yaw = yaw;
  return out;
}

/** Seat slide (T40): how far back (+Z) from the designed eye point the seated head is placed, like an aircraft seat track. */
export const SEAT_DEFAULT_M = 0.3;
export const SEAT_MIN_M = 0;
export const SEAT_MAX_M = 0.5;
export const SEAT_STEP_M = 0.05;

/** Nearest allowed seat offset: the range, on the 0.05 m grid. A non-finite number gives the default. */
export function clampSeat(m: number): number {
  if (!Number.isFinite(m)) return SEAT_DEFAULT_M;
  const steps = Math.round(Math.min(SEAT_MAX_M, Math.max(SEAT_MIN_M, m)) / SEAT_STEP_M);
  // whole centimetres, so 3 steps is exactly 0.15 and not 0.15000000000000002
  return (steps * 5) / 100;
}

/** One press of SEAT BACK (+1, the eye moves away from the panel) or SEAT FWD (-1, toward it); stays inside the range. */
export function stepSeat(m: number, dir: 1 | -1): number {
  return clampSeat(clampSeat(m) + dir * SEAT_STEP_M);
}

/** Button label text for an offset: "SEAT +10 cm". */
export function seatLabel(m: number): string {
  return `SEAT +${Math.round(clampSeat(m) * 100)} cm`;
}
