/**
 * F28 magnify: toggleMagnify(displayId) lifts a display panel to 0.45 m in front of the head at 1.6x scale;
 * toggling again restores its exact original parent and transform. The depth test stays ON so hands in front of the
 * panel still draw over it (the 0.45 m plane is nearer than any cockpit surface). The display's MAG tab (an
 * `attachment`) is repositioned onto the same corner of the lifted panel (58 mm at 1.6x), so the panel can always be
 * dismissed. The tab is NOT reparented: it is an ECS pad entity whose mesh must stay under its zone.
 * Triggered by the poke "magnify" corner tab on each display (hands-only fallback; see displays/index.ts).
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';

export type DisplayId = 'pfd' | 'nd' | 'alerts';
export const MAGNIFY_DISTANCE_M = 0.45;
export const MAGNIFY_SCALE = 1.6;

/** World pose for a magnified panel: straight ahead of the head, facing it. */
export function magnifyPose(headPos: Vector3, headQuat: Quaternion): { position: Vector3; quaternion: Quaternion } {
  const position = new Vector3(0, 0, -MAGNIFY_DISTANCE_M).applyQuaternion(headQuat).add(headPos);
  return { position, quaternion: headQuat.clone() };
}

interface Saved {
  parent: Object3D;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  attachment?: { position: Vector3; quaternion: Quaternion; scale: Vector3 };
}

const tmpPos = new Vector3();
const tmpQuat = new Quaternion();

export class Magnifier {
  private readonly panels = new Map<DisplayId, Object3D>();
  private readonly attachments = new Map<DisplayId, Object3D>();
  private readonly saved = new Map<DisplayId, Saved>();

  constructor(
    private readonly scene: Object3D,
    private readonly head: Object3D,
  ) {}

  /** `attachment` (the MAG tab mesh) moves onto the panel while it is magnified, keeping its local transform. */
  register(id: DisplayId, obj: Object3D, attachment?: Object3D): void {
    this.panels.set(id, obj);
    if (attachment) this.attachments.set(id, attachment);
  }

  isMagnified(id: DisplayId): boolean {
    return this.saved.has(id);
  }

  /** Toggle; returns the new magnified state (false for an unregistered display). */
  toggle(id: DisplayId): boolean {
    const obj = this.panels.get(id);
    if (!obj) return false;
    if (this.saved.has(id)) {
      this.restore(id);
      return false;
    }
    for (const other of [...this.saved.keys()]) this.restore(other);
    this.lift(id, obj);
    return true;
  }

  private lift(id: DisplayId, obj: Object3D): void {
    const att = this.attachments.get(id);
    this.saved.set(id, {
      parent: obj.parent ?? this.scene,
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
      attachment: att ? { position: att.position.clone(), quaternion: att.quaternion.clone(), scale: att.scale.clone() } : undefined,
    });
    this.head.updateWorldMatrix(true, false);
    const pose = magnifyPose(this.head.getWorldPosition(tmpPos), this.head.getWorldQuaternion(tmpQuat));
    const base = this.saved.get(id)!.scale;
    this.scene.add(obj);
    obj.position.copy(pose.position);
    obj.quaternion.copy(pose.quaternion);
    obj.scale.copy(base).multiplyScalar(MAGNIFY_SCALE);
    if (att?.parent) this.moveAttachment(att, obj, this.saved.get(id)!);
  }

  /** Put `att` on the same corner of the lifted panel `obj` (offset scaled by the magnification), keeping its parent. */
  private moveAttachment(att: Object3D, obj: Object3D, s: Saved): void {
    const parent = att.parent!;
    const a = s.attachment!;
    // offset of the tab from the panel, in the panel's own (original) frame
    const inv = s.quaternion.clone().invert();
    const off = a.position.clone().sub(s.position).applyQuaternion(inv).divide(s.scale).multiply(obj.scale);
    const world = off.applyQuaternion(obj.quaternion).add(obj.position);
    parent.updateWorldMatrix(true, false);
    att.position.copy(parent.worldToLocal(world));
    const parentQuat = parent.getWorldQuaternion(new Quaternion());
    att.quaternion.copy(parentQuat.invert().multiply(obj.quaternion).multiply(inv.multiply(a.quaternion)));
    att.scale.copy(a.scale).multiplyScalar(MAGNIFY_SCALE);
  }

  private restore(id: DisplayId): void {
    const obj = this.panels.get(id)!;
    const s = this.saved.get(id)!;
    s.parent.add(obj);
    obj.position.copy(s.position);
    obj.quaternion.copy(s.quaternion);
    obj.scale.copy(s.scale);
    const att = this.attachments.get(id);
    if (att && s.attachment) {
      att.position.copy(s.attachment.position);
      att.quaternion.copy(s.attachment.quaternion);
      att.scale.copy(s.attachment.scale);
    }
    this.saved.delete(id);
  }
}
