/**
 * Seat anchoring (T37): when an immersive session starts, move the player rig so the tracked head sits on
 * HEAD_ANCHOR facing the cockpit, wherever the user is in their room (math in seatMath.ts). Without it the cockpit
 * stays where the room's floor origin happens to be, so it opens too near, too far or through the user.
 *
 * The anchor is HEAD_ANCHOR plus the seat offset straight back (T40), so the user sits an arm's length from the panels.
 *
 * Re-anchors on every new session and when the headset reports a recentre (the reference space's `reset` event, which
 * the Quest sends after its own recentre gesture). The rig goes back to the origin when the session ends, so the 2D
 * page view is unchanged. Nothing else writes the rig transform (locomotion is off in iwsdk.config.json).
 */
import { createSystem } from '@iwsdk/core';
import { HEAD_ANCHOR } from './cockpit/layout';
import { SEAT_DEFAULT_M, clampSeat, seatTransform, type SeatPose } from './seatMath';

/**
 * Seat slide (T40): how far behind HEAD_ANCHOR (+Z, metres) the tracked head is placed. Module level like setOutsideFlight
 * in outside/sky.ts: the screens' SEAT buttons and index.ts set it, this system reads it. The cockpit itself never moves.
 */
let seatOffset = SEAT_DEFAULT_M;
export function setSeatOffset(m: number): void {
  seatOffset = clampSeat(m);
}
export function getSeatOffset(): number {
  return seatOffset;
}

/** Frames of tracking to wait for after a session starts or a recentre, before reading the head pose. */
const SETTLE_FRAMES = 10;
/**
 * A headset can report an estimated position (`emulatedPosition`) until its tracking locks. Wait for a tracked
 * position up to this many frames, then anchor to what there is (a headset without position tracking never locks).
 */
const TRACKING_WAIT_FRAMES = 120;

export class SeatSystem extends createSystem({}) {
  private anchored = false;
  private frames = 0;
  private waited = 0;
  private wasPresenting = false;
  private space: XRReferenceSpace | null = null;
  /** The offset the rig is currently placed for; a change of `seatOffset` while anchored shifts the rig by the difference. */
  private appliedOffset = SEAT_DEFAULT_M;
  private readonly anchor: [number, number, number] = [HEAD_ANCHOR[0], HEAD_ANCHOR[1], HEAD_ANCHOR[2]];
  private readonly pose: SeatPose = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly headPos: [number, number, number] = [0, 0, 0];
  private readonly headQuat: [number, number, number, number] = [0, 0, 0, 1];
  private readonly onReset = (): void => {
    this.anchored = false;
    this.frames = 0;
    this.waited = 0;
  };

  init(): void {
    this.cleanupFuncs.push(() => this.unhook());
  }

  update(): void {
    const presenting = this.renderer.xr.isPresenting;
    if (!presenting) {
      if (this.wasPresenting) {
        this.wasPresenting = false;
        this.anchored = false;
        this.frames = 0;
        this.waited = 0;
        this.unhook();
        this.player.position.set(0, 0, 0);
        this.player.rotation.set(0, 0, 0);
        this.player.updateMatrixWorld(true);
      }
      return;
    }
    this.wasPresenting = true;
    const space = this.renderer.xr.getReferenceSpace();
    if (space !== this.space) {
      this.unhook();
      this.space = space;
      space?.addEventListener('reset', this.onReset);
    }
    if (this.anchored) {
      if (this.appliedOffset !== seatOffset) {
        // the rig's position is a world-frame translation, so the head moves by exactly the difference whatever the heading
        this.player.position.z += seatOffset - this.appliedOffset;
        this.appliedOffset = seatOffset;
        this.player.updateMatrixWorld(true);
      }
      return;
    }
    const head = this.player.head;
    const p = head.position;
    const q = head.quaternion;
    // Before the first tracked frame the head is exactly at the rig origin with no rotation: keep waiting.
    if (p.x === 0 && p.y === 0 && p.z === 0 && q.w === 1) return;
    if (space && this.xrFrame && this.waited < TRACKING_WAIT_FRAMES && this.xrFrame.getViewerPose(space)?.emulatedPosition) {
      this.waited++;
      this.frames = 0;
      return;
    }
    if (++this.frames < SETTLE_FRAMES) return;
    this.headPos[0] = p.x;
    this.headPos[1] = p.y;
    this.headPos[2] = p.z;
    this.headQuat[0] = q.x;
    this.headQuat[1] = q.y;
    this.headQuat[2] = q.z;
    this.headQuat[3] = q.w;
    this.anchor[2] = HEAD_ANCHOR[2] + seatOffset;
    this.appliedOffset = seatOffset;
    seatTransform(this.headPos, this.headQuat, this.anchor, this.pose);
    this.player.position.set(this.pose.x, this.pose.y, this.pose.z);
    this.player.rotation.set(0, this.pose.yaw, 0);
    this.player.updateMatrixWorld(true);
    this.anchored = true;
  }

  private unhook(): void {
    this.space?.removeEventListener('reset', this.onReset);
    this.space = null;
  }
}
