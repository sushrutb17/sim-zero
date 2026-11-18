/**
 * Displays wiring (Task 9): replaces the three `face:<key>` surfaces with canvas panels (PFD, ND, alerts),
 * installs the overhead status strip, the alert ACK pad (autopilot strip, right end) and one magnify tab per
 * display. Task 11 feeds it: displays.setAircraft(state) each frame and bus cues (alert / alertClear) arrive via bus.onCue.
 */
import { CanvasTexture, Color, createSystem, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Vector3, type Entity, type World } from '@iwsdk/core';
import type { AircraftState, ControlId } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { THEME } from '../theme';
import { AUX_PADS, ZONES, type AuxPadId } from '../cockpit/layout';
import { builtZoneEntities } from '../cockpit/buildCockpit';
import { installOverhead } from '../cockpit/overhead';
import { PressDebouncer } from '../controls/controlLogic';
import { boxGeometry, createPad, type CockpitControl } from '../controls/controlBase';
import { DevDisplaysState } from '../controls/components';
import { AlertsModel, drawAlerts, type ActiveAlert } from './alerts';
import { createCanvasPanel, type CanvasPanel } from './canvasPanel';
import { PX_PER_M, text, u } from './drawUtil';
import { Magnifier, type DisplayId } from './magnify';
import { destinationLabel, drawNd } from './nd';
import { drawPfd } from './pfd';

/** Display quads sit 0.3 mm proud of the old face (face front is at z = +0.0005). */
const DISPLAY_Z = 0.0008;
const PULSE_PERIOD_MS = 500;

export interface Displays {
  setLive(live: boolean): void;
  setAircraft(s: AircraftState): void;
  alerts: AlertsModel;
  /** Airport id -> scenario name (Task 11 fills it from scenario.airports). The ND shows the UPPER-CASED name; unknown id = blank. */
  setAirportNames(map: Record<string, string>): void;
  /** Resets the alert list (session restart / redo) and redraws the alerts display. */
  resetAlerts(list?: readonly ActiveAlert[]): void;
  magnifier: Magnifier;
  /** Per-frame work (redraw gates). `nowMs` is a monotonic ms clock. */
  tick(nowMs: number): void;
  /** Extra per-frame callbacks (the dev demo driver). */
  addTicker(fn: (nowMs: number) => void): void;
}

let active: Displays | undefined;

/** Registered in index.ts; runs the redraw gates once per frame (no allocation). */
export class DisplaysSystem extends createSystem({}) {
  update(): void {
    active?.tick(performance.now());
  }
}

/** A pad whose front shows a label drawn once into a canvas texture (no extra draw call: it is the pad's own material map). */
function labelledPad(world: World, zoneEntity: Entity, id: AuxPadId, label: string, onPress: () => void) {
  const spec = AUX_PADS[id];
  // The pad sits in a holder frame at its zone-local centre. The control system rewrites pad.mesh.position.z every
  // frame, so anything that moves the pad (magnify) moves the HOLDER instead.
  const holderObj = new Object3D();
  holderObj.name = `holder:${id}`;
  holderObj.position.set(spec.center[0], spec.center[1], 0);
  const parent = world.createTransformEntity(holderObj, zoneEntity);
  const [w, h] = spec.size;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX_PER_M);
  canvas.height = Math.round(h * PX_PER_M);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = THEME.color.panelEdge;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = THEME.color.textDim;
  ctx.lineWidth = u(0.0008);
  ctx.strokeRect(u(0.002), u(0.002), canvas.width - u(0.004), canvas.height - u(0.004));
  text(ctx, label, w / 2, h / 2, 'body', THEME.color.text, 'center');
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const { pad } = createPad(world, {
    controlId: id,
    parent,
    geometry: boxGeometry(w, h),
    at: [0, 0],
    centerZ: 0.006,
    name: `pad:${id}`,
    debounce: new PressDebouncer(),
    onPress,
  });
  const mat = pad.materials[0];
  mat.map = tex;
  mat.color.set(new Color('#ffffff'));
  mat.needsUpdate = true;
  return { pad, holder: holderObj };
}

export function createDisplays(world: World, bus: EventBus, controls: Map<ControlId, CockpitControl>): Displays {
  const model = new AlertsModel();
  let aircraft: AircraftState | undefined;
  let pulsePhase = true;
  let lastPulseSlot = -1;
  const tickers: Array<(nowMs: number) => void> = [];

  const zoneObj = (k: keyof typeof ZONES) => builtZoneEntities[k]!.object3D!;

  const makePanel = (key: 'pfd' | 'nd' | 'alerts', draw: (ctx: CanvasRenderingContext2D) => void): CanvasPanel => {
    const zone = zoneObj(key);
    const old = zone.getObjectByName(`face:${key}`) as Mesh | undefined;
    if (old) {
      zone.remove(old);
      old.geometry.dispose(); // the shared face material stays (other zones use it)
    }
    const [w, h] = ZONES[key].size;
    const panel = createCanvasPanel(w, h, PX_PER_M);
    panel.mesh.name = `display:${key}`;
    panel.mesh.position.z = DISPLAY_Z;
    zone.add(panel.mesh);
    panel.setDraw(draw);
    return panel;
  };

  const pfd = makePanel('pfd', (c) => aircraft && drawPfd(c, aircraft));
  let airportNames: Record<string, string> = {};
  const nd = makePanel('nd', (c) => aircraft && drawNd(c, aircraft, destinationLabel(airportNames, aircraft.destination)));
  const alertsPanel = makePanel('alerts', (c) => aircraft && drawAlerts(c, model.list, aircraft.elec, pulsePhase));
  model.onChange = () => alertsPanel.markDirty();
  const overhead = installOverhead(controls, zoneObj('overhead'));

  const magnifier = new Magnifier(world.scene, world.camera);

  // dev snapshot readable with `ecs query` (verification only)
  let devEntity: Entity | undefined;
  let tabPresses = 0;
  const syncDev = () => {
    if (!devEntity) return;
    const mag = (['pfd', 'nd', 'alerts'] as DisplayId[]).filter((d) => magnifier.isMagnified(d)).join(',');
    devEntity.setValue(DevDisplaysState, 'magnified', mag);
    devEntity.setValue(DevDisplaysState, 'alerts', model.list.map((a) => `${a.id}:${a.level}:${a.acked ? 'acked' : 'new'}`).join(';'));
    devEntity.setValue(DevDisplaysState, 'tabPresses', tabPresses);
  };
  if (import.meta.env.MODE !== 'production') {
    const o = new Object3D();
    o.name = 'dev-displays-state';
    devEntity = world.createTransformEntity(o);
    devEntity.addComponent(DevDisplaysState, { magnified: '', alerts: '', tabPresses: 0 });
    // window.__trainer.padPosition('alerts.ack' | 'magnify.pfd' ...): world position of a pad's front face (verification)
    const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
    g.__trainer = {
      ...g.__trainer,
      /** Names of visible meshes (draw-call audit). */
      visibleMeshes(): string[] {
        const out: string[] = [];
        world.scene.traverseVisible((o) => {
          if ((o as Mesh).isMesh) out.push(o.name || o.parent?.name || o.type);
        });
        return out;
      },
      padPosition(id: string): [number, number, number] {
        const m = world.scene.getObjectByName(`pad:${id}`);
        if (!m) throw new Error(`unknown pad '${id}'`);
        m.updateWorldMatrix(true, false);
        const v = m.localToWorld(new Vector3(0, 0, 0.006));
        return [v.x, v.y, v.z];
      },
    };
  }
  const prevOnChange = model.onChange;
  model.onChange = () => {
    prevOnChange?.();
    syncDev();
  };

  // ACK pad: ONE alertAck for the highest-priority unacked alert; no-op when none.
  // It glows alert.warning (a halo plane behind the pad, hidden = no draw) while a warning is unacknowledged.
  const ackSpec = AUX_PADS['alerts.ack'];
  const halo = new Mesh(
    new PlaneGeometry(ackSpec.size[0] + 0.012, ackSpec.size[1] + 0.012),
    new MeshBasicMaterial({ color: new Color(THEME.alert.warning), toneMapped: false }),
  );
  halo.name = 'glow:alerts.ack';
  halo.position.set(ackSpec.center[0], ackSpec.center[1], 0.0015);
  halo.visible = false;
  builtZoneEntities.autopilot!.object3D!.add(halo);
  const syncGlow = () => {
    halo.visible = model.hasUnackedWarning();
  };
  const glowPrev = model.onChange;
  model.onChange = () => {
    glowPrev?.();
    syncGlow();
  };
  labelledPad(world, builtZoneEntities.autopilot!, 'alerts.ack', 'ACK', () => {
    const id = model.ackHighest();
    if (id !== undefined) bus.emitAction({ kind: 'alertAck', alertId: id });
    syncDev();
  });
  // magnify tabs: the hands-only trigger for F28
  for (const key of ['pfd', 'nd', 'alerts'] as const) {
    const tab = labelledPad(world, builtZoneEntities[key]!, `magnify.${key}`, 'MAG', () => {
      magnifier.toggle(key); // also the close tab: it rides on the magnified panel
      tabPresses++;
      syncDev();
    });
    magnifier.register(key, { pfd, nd, alerts: alertsPanel }[key].mesh, tab.holder);
  }

  bus.onCue(({ body }) => model.apply(body));

  const prev = { spd: NaN, alt: NaN, hdg: NaN, phase: '', apEng: false, apLat: '', apVert: '', apAlt: NaN, storm: NaN as number | null, dest: '', g1s: false, g1f: false, g2s: false, g2f: false };

  const displays: Displays = {
    setLive(live) { model.live = live; },
    alerts: model,
    setAirportNames(map) {
      airportNames = { ...map };
      nd.markDirty();
    },
    resetAlerts: (list = []) => model.reset(list),
    magnifier,
    setAircraft(s) {
      aircraft = s;
      overhead.bindOverhead(s);
      const spd = Math.round(s.speedKt);
      const alt = Math.round(s.altitudeFt / 10);
      const hdg = Math.round(s.headingDeg);
      if (spd !== prev.spd || alt !== prev.alt || hdg !== prev.hdg || s.phase !== prev.phase || s.ap.engaged !== prev.apEng || s.ap.lateral !== prev.apLat || s.ap.vertical !== prev.apVert || s.ap.alt !== prev.apAlt) pfd.markDirty();
      if (hdg !== prev.hdg || s.stormBearingDeg !== prev.storm || s.destination !== prev.dest) nd.markDirty();
      const e = s.elec;
      if (e.gen1.switchOn !== prev.g1s || e.gen1.failed !== prev.g1f || e.gen2.switchOn !== prev.g2s || e.gen2.failed !== prev.g2f) alertsPanel.markDirty();
      Object.assign(prev, { spd, alt, hdg, phase: s.phase, apEng: s.ap.engaged, apLat: s.ap.lateral, apVert: s.ap.vertical, apAlt: s.ap.alt, storm: s.stormBearingDeg, dest: s.destination, g1s: e.gen1.switchOn, g1f: e.gen1.failed, g2s: e.gen2.switchOn, g2f: e.gen2.failed });
    },
    tick(nowMs) {
      for (const t of tickers) t(nowMs);
      if (model.hasUnackedWarning()) {
        const slot = Math.floor(nowMs / PULSE_PERIOD_MS);
        if (slot !== lastPulseSlot) {
          lastPulseSlot = slot;
          pulsePhase = slot % 2 === 0;
          alertsPanel.markDirty();
        }
      }
      pfd.tick(nowMs);
      nd.tick(nowMs);
      alertsPanel.tick(nowMs);
      overhead.panel.tick(nowMs);
    },
    addTicker: (fn) => void tickers.push(fn),
  };
  active = displays;
  return displays;
}
