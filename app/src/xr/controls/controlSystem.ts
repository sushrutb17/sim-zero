/**
 * ONE system for every cockpit control:
 *  - qualify(Pressed) on a CockpitPad -> that pad's onPress (debounce + logic + bus.emitAction)
 *  - update(): hover / press feedback (emissive + 4 mm travel) and lever easing, no per-frame allocation
 *  - attaches loaded UIKitML label documents to the labels registry
 */
import { Color, createSystem, Hovered, PanelDocument, Pressed, type UIKitDocument } from '@iwsdk/core';
import { THEME } from '../theme';
import { CockpitPad, LabelPanel } from './components';
import { pads } from './controlBase';
import { attachLabelDocument } from './labels';

const HOVER_IN_S = 0.08;
const HOVER_OUT_S = 0.15;
const LEVER_S = 0.08;
const HOVER_COLOR = new Color(THEME.color.hover);
const PRESSED_COLOR = new Color(THEME.color.pressed);

export class CockpitControlSystem extends createSystem({
  pads: { required: [CockpitPad] },
  pressed: { required: [CockpitPad, Pressed] },
  labelDocs: { required: [LabelPanel, PanelDocument] },
}) {
  init(): void {
    this.queries.pressed.subscribe('qualify', (entity) => {
      const pad = pads[entity.getValue(CockpitPad, 'handler') as number];
      if (pad) pad.onPress();
    });
    this.queries.labelDocs.subscribe('qualify', (entity) => {
      const key = entity.getValue(LabelPanel, 'key') as string;
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
      if (doc) attachLabelDocument(key, doc);
    });
  }

  update(delta: number): void {
    const now = performance.now();
    for (const entity of this.queries.pads.entities) {
      const pad = pads[entity.getValue(CockpitPad, 'handler') as number];
      if (!pad) continue;
      const hovered = pad.enabled && entity.hasComponent(Hovered);
      const flashing = now < pad.flashUntil;

      pad.hoverLevel = approach(pad.hoverLevel, hovered ? 1 : 0, delta / (hovered ? HOVER_IN_S : HOVER_OUT_S));
      pad.pressLevel = approach(pad.pressLevel, flashing ? 1 : 0, delta / (flashing ? HOVER_IN_S : HOVER_OUT_S));

      const intensity = Math.max(pad.hoverLevel * THEME.control.hoverEmissive, pad.pressLevel * THEME.control.pressedEmissive);
      if (Math.abs(intensity - pad.lastEmissive) > 0.002) {
        pad.lastEmissive = intensity;
        const c = pad.pressLevel > 0.01 ? PRESSED_COLOR : HOVER_COLOR;
        for (const m of pad.materials) {
          m.emissive.copy(c);
          m.emissiveIntensity = intensity;
        }
      }
      pad.mesh.position.z = pad.restZ - THEME.control.pressTravelM * pad.pressLevel;

      const lever = pad.lever;
      if (lever) {
        const p = lever.object.position;
        if (p.y !== lever.target) p.y = approach(p.y, lever.target, (Math.abs(lever.target) * 2 * delta) / LEVER_S);
      }
    }
  }
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
