/**
 * Cockpit LAYOUT (metres). No @iwsdk/core import so tests can check it in node.
 * All positions are RELATIVE to the head anchor (the seated eye point). Forward is -Z, up is +Y.
 * World position = HEAD_ANCHOR + pos. Orientation uses Euler order YXZ (yaw rotY, then pitch rotX):
 * every panel faces the anchor so its text keeps its apparent cap height (visual-direction.md section 4).
 */
import type { ControlId } from '../../contracts/aircraft';

/** Seated eye point in world coordinates (the player origin is at 0,0,0; IWER headset at y 1.2 in tests). */
export const HEAD_ANCHOR: readonly [number, number, number] = [0, 1.2, 0];
/** Right-seat voice source relative to the seated head anchor. */
export const CREW_VOICE_POS: Vec3 = [0.55, -0.05, -0.05];
/** Reach limit from the anchor for every zone and control centre. */
export const MAX_REACH_M = 0.65;

export type Vec3 = readonly [number, number, number];

export interface LayoutEntry {
  pos: Vec3;
  rotY?: number;
  /** Pitch (rad) about X, applied after yaw (YXZ). Computed by faceAnchor(): negative tilts the face up toward the eye. */
  rotX?: number;
  /** [width, height] in metres (zones: panel face; controls: hit area of the group). */
  size: readonly [number, number];
}

export function distanceFromAnchor(pos: Vec3): number {
  return Math.hypot(pos[0], pos[1], pos[2]);
}

/** Yaw/pitch (YXZ) that point a panel's +Z normal from `pos` toward the anchor (origin of relative space). */
export function faceAnchor(pos: Vec3): { rotY: number; rotX: number } {
  const dx = -pos[0];
  const dy = -pos[1];
  const dz = -pos[2];
  return { rotY: Math.atan2(dx, dz), rotX: -Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Offset a local (x right, y up, z out of the face) point by a zone frame (YXZ rotation) into relative space. */
export function localToRelative(zone: LayoutEntry, lx: number, ly: number, lz = 0): Vec3 {
  const cx = Math.cos(zone.rotX ?? 0);
  const sx = Math.sin(zone.rotX ?? 0);
  const cy = Math.cos(zone.rotY ?? 0);
  const sy = Math.sin(zone.rotY ?? 0);
  // Rx then Ry (YXZ): v' = Ry * Rx * v
  const y1 = ly * cx - lz * sx;
  const z1 = ly * sx + lz * cx;
  const x2 = lx * cy + z1 * sy;
  const z2 = -lx * sy + z1 * cy;
  return [zone.pos[0] + x2, zone.pos[1] + y1, zone.pos[2] + z2];
}

function zone(pos: Vec3, size: readonly [number, number]): LayoutEntry {
  return { pos, size, ...faceAnchor(pos) };
}

export const ZONES = {
  overhead: zone([0, 0.27, -0.36], [0.56, 0.16]),
  // Mockup order, top to bottom: windscreen, single-row glareshield autopilot strip (the right-hand
  // ~0.066 m is reserved for Task 9's ACK pad), displays, pedestal. Verified by the line-of-sight test.
  autopilot: zone([0, -0.1, -0.5], [0.82, 0.075]),
  pfd: zone([-0.25, -0.28, -0.5], [0.19, 0.16]),
  nd: zone([0, -0.28, -0.5], [0.22, 0.16]),
  alerts: zone([0.25, -0.28, -0.5], [0.19, 0.16]),
  // Task 10 (fix round 1): every panel pad stays within 55 degrees of straight ahead and 0.65 m of the eye (seated comfort).
  // The comms panel is a tall, wide tablet low and close in front (one message + its reply cards per page at THEME body);
  // it sits steeper than the other pedestal panels because a 0.29 m tall panel at 50 degrees would hide the display row
  // (line-of-sight test). The checklist mirrors the route panel on the left (both about 28 degrees below eye level, yaw
  // 54). Under the line-of-sight test no lower-left spot is free for the kneeboard, so it sits above the checklist
  // (about 5 degrees above eye level, yaw 53) with all its pads on its front-facing half.
  checklist: zone([-0.439, -0.30, -0.319], [0.26, 0.24]),
  comms: zone([0, -0.484, -0.339], [0.52, 0.29]),
  route: zone([0.439, -0.30, -0.319], [0.2, 0.26]),
  kneeboard: zone([-0.478, 0.05, -0.360], [0.22, 0.42]),
} as const;

export type ZoneKey = keyof typeof ZONES;

/** Local (zone-frame) centres of each control group: [x, y]. Used by layout and by the cockpit builders. */
export const LOCAL = {
  // Single row (y -0.008): BARO | HDG | LATERAL | AP | VERTICAL | ALT, 13 mm between groups.
  'baro.set': [-0.32, -0.008],
  'ap.hdg': [-0.157, -0.008],
  'ap.lateral': [-0.025, -0.008],
  'ap.engage': [0.056, -0.008],
  'ap.vertical': [0.137, -0.008],
  'ap.alt': [0.269, -0.008],
  'elec.gen1': [-0.2, -0.005],
  'elec.gen2': [-0.115, -0.005],
  'elec.busTie': [-0.015, -0.005],
  'lights.landing': [0.1, -0.005],
  'lights.strobe': [0.185, -0.005],
  'practice.toggle': [0, 0.115],
  // Task 10: the route rows (centre of the single column) sit in the route zone; the PA button sits at the top left of the
  // comms zone. radio.com1 is NOT built (the scenario changes frequency through cue patches); the entry only keeps
  // LAYOUT total over ControlId.
  'radio.com1': [0, -0.03],
  'route.destination': [0, -0.018],
  'pa.cabin': [-0.225, 0.1195],
} as const;

type BuiltControlId = keyof typeof LOCAL;

const CONTROL_ZONE: Record<BuiltControlId, ZoneKey> = {
  'baro.set': 'autopilot',
  'ap.hdg': 'autopilot',
  'ap.alt': 'autopilot',
  'ap.lateral': 'autopilot',
  'ap.engage': 'autopilot',
  'ap.vertical': 'autopilot',
  'elec.gen1': 'overhead',
  'elec.gen2': 'overhead',
  'elec.busTie': 'overhead',
  'lights.landing': 'overhead',
  'lights.strobe': 'overhead',
  'practice.toggle': 'kneeboard',
  'radio.com1': 'comms',
  'route.destination': 'route',
  'pa.cabin': 'comms',
};

/** Overall hit-area size of each control group [w, h] (steppers and selectors span their pads). */
const CONTROL_SIZE: Record<BuiltControlId, readonly [number, number]> = {
  'baro.set': [0.15, 0.042],
  'ap.hdg': [0.15, 0.042],
  'ap.alt': [0.15, 0.042],
  'ap.lateral': [0.088, 0.042],
  'ap.engage': [0.048, 0.042],
  'ap.vertical': [0.088, 0.042],
  'elec.gen1': [0.045, 0.055],
  'elec.gen2': [0.045, 0.055],
  'elec.busTie': [0.06, 0.055],
  'lights.landing': [0.045, 0.055],
  'lights.strobe': [0.045, 0.055],
  'practice.toggle': [0.12, 0.045],
  'radio.com1': [0.17, 0.06],
  'route.destination': [0.18, 0.216],
  'pa.cabin': [0.05, 0.035],
};

/** Route options: a single column of up to four rows (all pad centres on the panel's centre line); offsets from LOCAL['route.destination']. */
export const ROUTE_CELL_SIZE: readonly [number, number] = [0.18, 0.042];
export const ROUTE_CELL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.081],
  [0, 0.027],
  [0, -0.027],
  [0, -0.081],
];

/** Pad rectangles of each built control in ZONE-local metres: [dx, dy, w, h] relative to LOCAL[id]. */
export const PAD_RECTS: Partial<Record<BuiltControlId, ReadonlyArray<readonly [number, number, number, number]>>> = {
  'baro.set': [[-0.056, 0, 0.038, 0.042], [0.056, 0, 0.038, 0.042]],
  'ap.hdg': [[-0.056, 0, 0.038, 0.042], [0.056, 0, 0.038, 0.042]],
  'ap.alt': [[-0.056, 0, 0.038, 0.042], [0.056, 0, 0.038, 0.042]],
  'ap.lateral': [[-0.026, 0, 0.036, 0.042], [0.026, 0, 0.036, 0.042]],
  'ap.engage': [[0, 0, 0.048, 0.042]],
  'ap.vertical': [[-0.026, 0, 0.036, 0.042], [0.026, 0, 0.036, 0.042]],
  'elec.gen1': [[0, 0, 0.045, 0.055]],
  'elec.gen2': [[0, 0, 0.045, 0.055]],
  'elec.busTie': [[0, 0, 0.06, 0.055]],
  'lights.landing': [[0, 0, 0.045, 0.055]],
  'lights.strobe': [[0, 0, 0.045, 0.055]],
  'practice.toggle': [[0, 0, 0.12, 0.045]],
  // Task 10: four 180 x 42 mm route rows (12 mm gaps), and the PA button.
  'route.destination': ROUTE_CELL_OFFSETS.map(([dx, dy]) => [dx, dy, ROUTE_CELL_SIZE[0], ROUTE_CELL_SIZE[1]] as const),
  'pa.cabin': [[0, 0, 0.05, 0.035]],
};

/** Pads added by Task 9 (not ControlIds): the alert ACK pad and one "magnify" corner tab per display. */
export type AuxPadId = 'alerts.ack' | 'magnify.pfd' | 'magnify.nd' | 'magnify.alerts';

const TAB_SIZE = 0.036;
const TAB_INSET = 0.002;
const tab = (key: 'pfd' | 'nd' | 'alerts') => {
  const [zw, zh] = ZONES[key].size;
  return { zone: key as ZoneKey, center: [zw / 2 - TAB_SIZE / 2 - TAB_INSET, zh / 2 - TAB_SIZE / 2 - TAB_INSET] as const, size: [TAB_SIZE, TAB_SIZE] as const };
};

/** Zone-local centre and size of each Task 9 pad. ACK sits in the ~0.066 m reserved at the RIGHT end of the autopilot strip. */
export const AUX_PADS: Readonly<Record<AuxPadId, { zone: ZoneKey; center: readonly [number, number]; size: readonly [number, number] }>> = {
  'alerts.ack': { zone: 'autopilot', center: [0.378, -0.008], size: [0.04, 0.042] },
  'magnify.pfd': tab('pfd'),
  'magnify.nd': tab('nd'),
  'magnify.alerts': tab('alerts'),
};

// ---------------------------------------------------------------------------------------------------------
// Task 10 panel geometry (zone-local metres, y up). Pure so the layout tests and the panel views share it.
// ---------------------------------------------------------------------------------------------------------
/** Inner margin of every canvas panel. */
export const PANEL_MARGIN = 0.01;
export const MIN_GAP = 0.012;
export const HIT = 0.035;

export type PanelPadId = `panel:${string}`;
export interface PanelPadSpec {
  zone: ZoneKey;
  center: readonly [number, number];
  size: readonly [number, number];
}

/**
 * Comms panel (0.52 x 0.29). Top row: PA button (left) and up to five page pads (right, RECENT always rightmost).
 * Below: ONE message page (channel tag + full text at THEME body, then ITS OWN reply cards, full width). Pages are
 * every unanswered message of the current event set (newest first) plus RECENT. Four pads show message pages; with more
 * than four the last message pad becomes MORE and cycles the visible window. Pages are never retired for space.
 */
export const COMMS_MESSAGE_PAGES_MAX = 4;
export const COMMS_PAGES_MAX = COMMS_MESSAGE_PAGES_MAX + 1;
export const COMMS_CARDS_PER_PAGE_MAX = 6;
export const COMMS_PAGE_PAD_W = 0.078;
export function commsGeo() {
  const [W, H] = ZONES.comms.size;
  const top = H / 2;
  const rowCy = top - 0.008 - HIT / 2;
  const pitch = COMMS_PAGE_PAD_W + MIN_GAP;
  const rightEdge = W / 2 - PANEL_MARGIN;
  const pa = LOCAL['pa.cabin'];
  const contentTop = rowCy - HIT / 2 - MIN_GAP;
  const contentBottom = -H / 2 + 0.008;
  return {
    W,
    H,
    row: { cy: rowCy, h: HIT },
    pa: { cx: pa[0], cy: pa[1], w: 0.05, h: HIT },
    /** Right-aligned page pads; index 0 is the rightmost (RECENT). */
    dots: Array.from({ length: COMMS_PAGES_MAX }, (_, i) => ({ cx: rightEdge - COMMS_PAGE_PAD_W / 2 - i * pitch, cy: rowCy, w: COMMS_PAGE_PAD_W, h: HIT })),
    /** Message + cards area of a page. */
    content: { top: contentTop, bottom: contentBottom, h: contentTop - contentBottom, cx: 0, w: W - 2 * PANEL_MARGIN },
  };
}

/**
 * Checklist panel (0.26 x 0.24): title row (title + progress left, PREV/NEXT pads right) and up to three items per page in
 * ONE column (full-width rows, text wraps to two lines). Longer checklists page with the arrow pads.
 */
export const CHECK_ITEMS_PER_PAGE = 3;
export function checklistGeo() {
  const [W, H] = ZONES.checklist.size;
  const top = H / 2;
  const rowCy = top - 0.008 - HIT / 2;
  const rowsTop = rowCy - HIT / 2 - MIN_GAP;
  const rowH = 0.04;
  const arrowW = 0.045;
  const right = W / 2 - PANEL_MARGIN;
  return {
    W,
    H,
    header: { cy: rowCy, h: HIT, left: -W / 2 + PANEL_MARGIN },
    next: { cx: right - arrowW / 2, cy: rowCy, w: arrowW, h: HIT },
    prev: { cx: right - arrowW - MIN_GAP - arrowW / 2, cy: rowCy, w: arrowW, h: HIT },
    rowH,
    rowW: W - 2 * PANEL_MARGIN,
    rows: Array.from({ length: CHECK_ITEMS_PER_PAGE }, (_, i) => ({ cx: 0, cy: rowsTop - rowH / 2 - i * (rowH + MIN_GAP), w: W - 2 * PANEL_MARGIN, h: rowH })),
  };
}

/** Route panel (0.20 x 0.26): title row on top, then the column of option rows (LOCAL['route.destination'] is the block centre). */
export function routeGeo() {
  const [W, H] = ZONES.route.size;
  return { W, H, title: { cy: H / 2 - 0.02, h: 0.03 } };
}

/** Kneeboard (0.22 x 0.42): label panel title + practice switch on top, then page header, text, prev/next, hint box, hint + pause. */
export function kneeboardGeo() {
  const [W, H] = ZONES.kneeboard.size;
  return {
    W,
    H,
    header: { cy: 0.068, h: 0.02 },
    text: { top: 0.054, bottom: -0.048, cx: 0, w: W - 2 * PANEL_MARGIN },
    prev: { cx: -0.01, cy: -0.082, w: 0.06, h: 0.036 },
    next: { cx: 0.062, cy: -0.082, w: 0.06, h: 0.036 },
    hintBox: { top: -0.108, bottom: -0.166, cx: 0, w: W - 2 * PANEL_MARGIN },
    hint: { cx: -0.01, cy: -0.186, w: 0.06, h: 0.035 },
    pause: { cx: 0.068, cy: -0.186, w: 0.07, h: 0.035 },
  };
}

/** Static panel pads (not ControlIds): everything except the dynamic reply cards, which are packed at runtime. */
export const PANEL_PADS: Readonly<Record<PanelPadId, PanelPadSpec>> = (() => {
  const out: Record<string, PanelPadSpec> = {};
  commsGeo().dots.forEach((d, i) => (out[`panel:comms.page.${i}`] = { zone: 'comms', center: [d.cx, d.cy], size: [d.w, d.h] }));
  const cg = checklistGeo();
  cg.rows.forEach((r, i) => (out[`panel:check.row.${i}`] = { zone: 'checklist', center: [r.cx, r.cy], size: [r.w, r.h] }));
  for (const k of ['prev', 'next'] as const) out[`panel:check.${k}`] = { zone: 'checklist', center: [cg[k].cx, cg[k].cy], size: [cg[k].w, cg[k].h] };
  const kb = kneeboardGeo();
  for (const k of ['prev', 'next', 'hint', 'pause'] as const) out[`panel:kb.${k}`] = { zone: 'kneeboard', center: [kb[k].cx, kb[k].cy], size: [kb[k].w, kb[k].h] };
  return out as Record<PanelPadId, PanelPadSpec>;
})();

/** All Task-8 pad rectangles per zone as [cx, cy, w, h] in zone-local metres (used by the gap test). */
export function padRectsByZone(): Record<string, Array<readonly [number, number, number, number]>> {
  const out: Record<string, Array<readonly [number, number, number, number]>> = {};
  for (const id of Object.keys(PAD_RECTS) as BuiltControlId[]) {
    const z = CONTROL_ZONE[id];
    (out[z] ??= []);
    for (const [dx, dy, w, h] of PAD_RECTS[id]!) out[z].push([LOCAL[id][0] + dx, LOCAL[id][1] + dy, w, h]);
  }
  for (const a of Object.values(AUX_PADS)) (out[a.zone] ??= []).push([a.center[0], a.center[1], a.size[0], a.size[1]]);
  for (const a of Object.values(PANEL_PADS)) (out[a.zone] ??= []).push([a.center[0], a.center[1], a.size[0], a.size[1]]);
  return out;
}

function control(id: BuiltControlId): LayoutEntry {
  const z = ZONES[CONTROL_ZONE[id]];
  const [lx, ly] = LOCAL[id];
  // Controls stand 0.01 m proud of their panel face.
  return { pos: localToRelative(z, lx, ly, 0.01), rotX: z.rotX, rotY: z.rotY, size: CONTROL_SIZE[id] };
}

const controls = Object.fromEntries(
  (Object.keys(LOCAL) as BuiltControlId[]).map((id) => [id, control(id)]),
) as Record<BuiltControlId, LayoutEntry>;

/**
 * Controls built here + all zones (pfd, nd, alerts, checklist, comms, route, kneeboard, plus the
 * overhead and autopilot panels). route.destination, radio.com1 and pa.cabin (Task 10) are placed inside
 * the route/comms zones by Task 10 (reserved positions here).
 */
export const LAYOUT: Readonly<Record<ControlId | ZoneKey, LayoutEntry>> = {
  ...controls,
  ...ZONES,
};
