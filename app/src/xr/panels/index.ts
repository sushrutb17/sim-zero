/**
 * Panels facade (Task 10). Task 11 creates it once per session:
 *   const panels = createPanels(world, bus, scenario);
 *   session.onCue((cue) => panels.handleCue(cue));   // every stamped WorldCue; the panels pick what they show
 *   each frame:   panels.setAircraft(state);          // COM1 frequency + selected destination
 *   restart/redo: panels.reset();
 *   panels.onPause(() => session.pause());            // kneeboard Pause button (not a PilotAction)
 * Pilot actions (reply, checklistItem, hint, route.destination, pa.cabin) go out on `bus.emitAction`.
 * The PA button lives on the COMMS panel (cabin communication), the route cells on the ROUTE panel.
 */
import { createSystem, Object3D, type Entity, type Vector3, type World } from '@iwsdk/core';
import type { AircraftState } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import { pilotSafe, type Stamped, type WorldCue } from '../../contracts/events';
import type { Scenario } from '../../contracts/scenario';
import { builtZoneEntities } from '../cockpit/buildCockpit';
import { DevPanelsState } from '../controls/components';
import { createChecklist, type ChecklistView } from './checklist';
import { createComms, type CommsView } from './comms';
import { createKneeboard, type KneeboardView } from './kneeboard';
import { createRoute, type RouteView } from './route';

/** Canvas quads sit 0.8 mm proud of the zone face, like the Task 9 displays. */
const PANEL_Z = 0.0008;

export interface Panels {
  handleCue(cue: Stamped<WorldCue>): void;
  /** Another flight was chosen (T41): rebuilds the checklist, route and kneeboard from it, clears every message and takes its radio frequency. */
  setScenario(s: Scenario): void;
  setAircraft(s: AircraftState): void;
  /** Clears messages, cards, checklist ticks, shown hints and printouts (restart / redo). */
  reset(): void;
  onPause(cb: () => void): void;
  /** False while the engine takes no actions: reply, checklist, hint, route and PA presses are ignored (T11 fix round 1). */
  setLive(live: boolean): void;
  /** Per-frame work; called by PanelsSystem. */
  tick(nowMs: number): void;
  comms: CommsView;
  checklist: ChecklistView;
  route: RouteView;
  kneeboard: KneeboardView;
  /** Dev/test: world position of a press target (`card:<id>`, `check:<list>:<item>`, `route:<airport>`, `kb:hint|pause|next|prev`, `pa`, `page:<n>`). */
  targetPosition(id: string): [number, number, number];
}

let active: Panels | undefined;

/** Registered in index.ts; ticks the panels once per frame (redraw gates, deferred relayout). */
export class PanelsSystem extends createSystem({}) {
  update(): void {
    active?.tick(performance.now());
  }
}

export function createPanels(world: World, bus: EventBus, scenario: Scenario): Panels {
  const zone = (k: 'comms' | 'checklist' | 'route' | 'kneeboard'): Entity => builtZoneEntities[k]!;
  const comms = createComms(world, bus, zone('comms'), PANEL_Z);
  const checklist = createChecklist(world, bus, zone('checklist'), PANEL_Z, scenario.checklists);
  const route = createRoute(world, bus, zone('route'), PANEL_Z, scenario.airports, scenario.initialAircraft.destination);
  const kneeboard = createKneeboard(world, bus, zone('kneeboard'), PANEL_Z, scenario);
  comms.setFreq(scenario.initialAircraft.comFreq);
  const views = [comms, checklist, route, kneeboard];
  let pauses = 0;
  kneeboard.onPause(() => pauses++);

  const panels: Panels = {
    comms,
    checklist,
    route,
    kneeboard,
    handleCue({ body }) {
      const cue = pilotSafe(body); // throws on instructor-only fields: nothing unvetted reaches a headset panel
      switch (cue.kind) {
        case 'message':
          comms.apply(cue);
          break;
        case 'printout':
          kneeboard.addPrintout(cue.id, cue.title, cue.body);
          comms.notePrintout();
          break;
        case 'checklistAvailable':
          checklist.open(cue.checklistId);
          break;
        case 'eventSet':
          comms.apply(cue);
          if (cue.status === 'start') kneeboard.onEventSet(cue.eventSetId);
          break;
        default:
          break;
      }
    },
    setAircraft(s) {
      comms.setFreq(s.comFreq);
      route.setDestination(s.destination);
    },
    setScenario(s) {
      comms.reset();
      comms.setFreq(s.initialAircraft.comFreq);
      checklist.setDefs(s.checklists);
      route.setAirports(s.airports, s.initialAircraft.destination);
      kneeboard.setScenario(s);
    },
    reset() {
      for (const v of views) v.reset();
    },
    onPause: (cb) => kneeboard.onPause(cb),
    setLive(live) {
      comms.model.live = live;
      checklist.model.live = live;
      route.model.live = live;
      kneeboard.model.live = live;
    },
    tick(nowMs) {
      for (const v of views) v.tick(nowMs);
      syncDev();
    },
    targetPosition(id) {
      for (const v of views) {
        const f = v.targets()[id];
        const p: Vector3 | undefined = f?.();
        if (p) return [p.x, p.y, p.z];
      }
      throw new Error(`unknown or hidden target '${id}'`);
    },
  };

  // ---- dev only: ECS-readable snapshot + window.__trainer.targetPosition ----
  let devEntity: Entity | undefined;
  let lastSnap = '';
  let lastSnapAt = 0;
  const syncDev = () => {
    if (!devEntity) return;
    const now = performance.now();
    if (now - lastSnapAt < 200) return;
    lastSnapAt = now;
    const cards = comms.model.pendingCards().map((c) => `${c.messageId}/${c.cardId}`).join(';');
    const cl = checklist.model.current();
    const ticked = cl ? checklist.model.tickOrder().join(';') : '';
    const snap = `${cards}|${cl?.id ?? ''}|${ticked}|${route.model.selected()}|${kneeboard.model.hintText() ?? ''}|${kneeboard.model.pageIndex()}|${pauses}`;
    if (snap === lastSnap) return;
    lastSnap = snap;
    devEntity.setValue(DevPanelsState, 'cards', cards);
    devEntity.setValue(DevPanelsState, 'checklist', cl ? `${cl.id}:${ticked}` : '');
    devEntity.setValue(DevPanelsState, 'destination', route.model.selected());
    devEntity.setValue(DevPanelsState, 'hint', kneeboard.model.hintText() ?? '');
    devEntity.setValue(DevPanelsState, 'page', kneeboard.model.pageIndex());
    devEntity.setValue(DevPanelsState, 'pauses', pauses);
  };
  if (import.meta.env.MODE !== 'production') {
    const o = new Object3D();
    o.name = 'dev-panels-state';
    devEntity = world.createTransformEntity(o);
    devEntity.addComponent(DevPanelsState, { cards: '', checklist: '', destination: '', hint: '', page: 0, pauses: 0 });
    const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
    g.__trainer = {
      ...g.__trainer,
      /** [x, y, z] world position of a panel press target (Task 13): card:<cardId>, check:<checklistId>:<itemId>, route:<airportId>, kb:hint|pause|next|prev, pa, page:<n>. */
      targetPosition: (id: string) => panels.targetPosition(id),
      /** Draw-call audit: hide/show the four panel quads (the hit pads draw nothing either way). */
      setPanelsVisible: (b: boolean) => {
        for (const k of ['comms', 'checklist', 'route', 'kneeboard'] as const) zone(k).object3D!.traverse((o) => o.name.startsWith('panel:') && (o.visible = b));
      },
    };
  }

  active = panels;
  return panels;
}
