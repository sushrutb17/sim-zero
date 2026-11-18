/**
 * Route panel: one cell per scenario airport (name, ASCII), a single column of >= 40 mm rows. Poking a cell emits
 * {kind:'control', controlId:'route.destination', value:<airport id>}; the selected cell is highlighted (violet bar) and is
 * bound to AircraftState.destination through setDestination() (Task 11 calls it from setAircraft).
 */
import type { Entity, Vector3, World } from '@iwsdk/core';
import type { EventBus } from '../../bus/eventBus';
import type { AirportDef } from '../../contracts/scenario';
import { THEME } from '../theme';
import { LOCAL, ROUTE_CELL_OFFSETS, ROUTE_CELL_SIZE, routeGeo } from '../cockpit/layout';
import { RouteModel } from './panelModel';
import { ZoneCanvas, lineHeightM } from './draw';
import { wrapText } from './textLayout';
import { createPanelPad, type PanelPad } from './panelPad';
import type { PanelView } from './view';

export interface RouteView extends PanelView {
  setDestination(id: string): void;
  /** A different flight (T41): its airports fill the cells, `initial` is selected. */
  setAirports(airports: readonly AirportDef[], initial: string): void;
  model: RouteModel;
}

export function createRoute(world: World, bus: EventBus, zone: Entity, panelZ: number, airports: readonly AirportDef[], initial: string): RouteView {
  const g = routeGeo();
  const cells = (list: readonly AirportDef[]): AirportDef[] => {
    if (list.length > ROUTE_CELL_OFFSETS.length) console.warn(`route panel shows the first ${ROUTE_CELL_OFFSETS.length} of ${list.length} airports`);
    return list.slice(0, ROUTE_CELL_OFFSETS.length);
  };
  const model = new RouteModel(cells(airports), initial);
  const zc = new ZoneCanvas(g.W, g.H);
  zc.panel.mesh.name = 'panel:route';
  zc.panel.mesh.position.z = panelZ;
  zone.object3D!.add(zc.panel.mesh);
  const [lx, ly] = LOCAL['route.destination'];
  const [cw, ch] = ROUTE_CELL_SIZE;
  let sig = '';

  // One pad per airport id, made the first time that airport is listed and kept (hidden) when a later flight does not list it (T41).
  // The guide frames a cell by its pad's mesh name, `pad:route.<airportId>`, so a pad keeps the name of its airport for good.
  let rows = model.rows();
  const padFor = new Map<string, PanelPad>();
  const allPads: PanelPad[] = []; // the same pads, for the per-frame loops (no iterator allocation)
  const padOf = (id: string): PanelPad => {
    let pad = padFor.get(id);
    if (!pad) {
      pad = createPanelPad(world, zone, `route.${id}`, () => {
        const action = model.select(id); // null once a later flight no longer lists this airport
        if (action) bus.emitAction(action);
        zc.panel.markDirty();
      });
      padFor.set(id, pad);
      allPads.push(pad);
    }
    return pad;
  };
  const place = () => {
    for (const pad of allPads) pad.hide();
    rows.forEach((row, i) => {
      const [dx, dy] = ROUTE_CELL_OFFSETS[i];
      padOf(row.id).rect(lx + dx, ly + dy, cw, ch);
    });
  };
  place();

  function draw(): void {
    zc.clear();
    zc.text('ROUTE', -g.W / 2 + 0.01, g.title.cy, 'body', THEME.color.text, 'left', 700);
    zc.text('DESTINATION', g.W / 2 - 0.01, g.title.cy, 'min', THEME.color.textDim, 'right', 500);
    rows.forEach((row, i) => {
      const [dx, dy] = ROUTE_CELL_OFFSETS[i];
      const cx = lx + dx;
      const cy = ly + dy;
      const selected = row.id === model.selected();
      const pad = padOf(row.id);
      const fill = pad.press() > 0.5 ? THEME.color.pressedFill : pad.hover() > 0.5 ? THEME.color.hoverFill : THEME.color.panelEdge;
      zc.box(cx, cy, cw, ch, fill, pad.hover() > 0.5 ? { color: THEME.color.accent, width: 0.002 } : undefined);
      if (selected) zc.box(cx - cw / 2 + 0.003, cy, 0.004, ch - 0.01, THEME.color.accent, undefined, 0.002);
      // body text, wrapped; the row grows no taller than the cell, so a name that needs a third line is clamped at body size
      const lines = wrapText(row.name, cw - 0.024, zc.measurer('body', selected ? 700 : 500)).slice(0, Math.max(1, Math.floor((ch - 0.004) / lineHeightM('body'))));
      const textH = lines.length * lineHeightM('body');
      zc.lines(lines, cx - cw / 2 + 0.014, cy + textH / 2, 'body', selected ? THEME.color.text : THEME.color.textDim, 'left', selected ? 700 : 500);
    });
  }
  zc.panel.setDraw(draw);

  return {
    model,
    setAirports(list, initial) {
      model.setAirports(cells(list), initial);
      rows = model.rows();
      place();
      zc.panel.markDirty();
    },
    setDestination(id) {
      if (id === model.selected()) return;
      model.setDestination(id);
      zc.panel.markDirty();
    },
    tick(nowMs) {
      let s = '';
      for (const p of allPads) s += p.hover() > 0.5 ? 'h' : p.press() > 0.5 ? 'p' : '-';
      if (s !== sig) {
        sig = s;
        zc.panel.markDirty();
      }
      zc.panel.tick(nowMs);
    },
    reset() {
      zc.panel.markDirty();
    },
    targets() {
      const t: Record<string, () => Vector3 | undefined> = {};
      rows.forEach((row) => (t[`route:${row.id}`] = () => padOf(row.id).front()));
      return t;
    },
  };
}
