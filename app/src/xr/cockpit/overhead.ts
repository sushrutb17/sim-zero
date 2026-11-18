/**
 * Overhead electrical panel additions (Task 9). The gen1 / gen2 / busTie switches are Task 8's; this file adds
 * the status strip (BUS 1 / BUS 2 powered lights and the backup-gen INOP flag, drawn on ONE canvas quad) and
 * bindOverhead(state), which mirrors AircraftState onto the existing toggles for display only (setValue never emits).
 */
import type { Object3D } from '@iwsdk/core';
import type { AircraftState, ControlId } from '../../contracts/aircraft';
import { busStatus, genOnline, type Elec } from '../../engine/power';
import { THEME } from '../theme';
import type { CockpitControl } from '../controls/controlBase';
import { createCanvasPanel, type CanvasPanel } from '../displays/canvasPanel';
import { PX_PER_M, clearDisplay, text, u } from '../displays/drawUtil';

export { genOnline, busStatus };

const STRIP_W = 0.5;
const STRIP_H = 0.018;

/** Draws the status strip: two bus lights and the backup-gen flag. Lit = filled; unlit = outline (not colour alone). */
export function drawOverheadStrip(ctx: CanvasRenderingContext2D, e: Elec): void {
  clearDisplay(ctx);
  const bus = busStatus(e);
  const light = (cx: number, on: boolean) => {
    ctx.beginPath();
    ctx.arc(u(cx), u(STRIP_H / 2), u(0.0045), 0, Math.PI * 2);
    if (on) {
      ctx.fillStyle = THEME.display.normal;
      ctx.fill();
    } else {
      ctx.strokeStyle = THEME.color.textDim;
      ctx.lineWidth = u(0.0012);
      ctx.stroke();
    }
  };
  light(0.012, bus.bus1);
  text(ctx, 'BUS 1', 0.021, STRIP_H / 2, 'min', bus.bus1 ? THEME.color.text : THEME.color.textDim);
  light(0.075, bus.bus2);
  text(ctx, 'BUS 2', 0.084, STRIP_H / 2, 'min', bus.bus2 ? THEME.color.text : THEME.color.textDim);
  if (e.backupGenInop) {
    ctx.strokeStyle = THEME.alert.caution;
    ctx.lineWidth = u(0.0015);
    ctx.strokeRect(u(0.14), u(0.001), u(0.118), u(STRIP_H - 0.002));
    text(ctx, 'BACKUP GEN INOP', 0.145, STRIP_H / 2, 'min', THEME.alert.caution);
  } else {
    text(ctx, 'BACKUP GEN', 0.145, STRIP_H / 2, 'min', THEME.color.textDim);
  }
}

export interface OverheadBinding {
  panel: CanvasPanel;
  /** Mirror state onto the overhead: toggles (display only) and the status strip. Never emits an action. */
  bindOverhead(state: AircraftState): void;
}

/** Adds the status strip to the overhead zone frame and returns bindOverhead. */
export function installOverhead(controls: Map<ControlId, CockpitControl>, overheadZone: Object3D): OverheadBinding {
  const panel = createCanvasPanel(STRIP_W, STRIP_H, PX_PER_M);
  panel.mesh.name = 'overhead-status';
  panel.mesh.position.set(0, -0.0685, 0.0015);
  overheadZone.add(panel.mesh);
  let elec: Elec | undefined;
  panel.setDraw((ctx) => elec && drawOverheadStrip(ctx, elec));
  return {
    panel,
    bindOverhead(state) {
      controls.get('elec.gen1')?.setValue(state.elec.gen1.switchOn);
      controls.get('elec.gen2')?.setValue(state.elec.gen2.switchOn);
      controls.get('elec.busTie')?.setValue(state.elec.busTie);
      const changed =
        !elec ||
        elec.gen1.switchOn !== state.elec.gen1.switchOn || elec.gen1.failed !== state.elec.gen1.failed ||
        elec.gen2.switchOn !== state.elec.gen2.switchOn || elec.gen2.failed !== state.elec.gen2.failed ||
        elec.busTie !== state.elec.busTie || elec.backupGenInop !== state.elec.backupGenInop;
      elec = { gen1: { ...state.elec.gen1 }, gen2: { ...state.elec.gen2 }, backupGenInop: state.elec.backupGenInop, busTie: state.elec.busTie };
      if (changed) panel.markDirty();
    },
  };
}
