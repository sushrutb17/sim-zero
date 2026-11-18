/**
 * Screen host (Task 11): two canvas quads (small windscreen screen, large debrief screen; at most one visible, so
 * at most +1 draw call) and a fixed pool of invisible hit pads (Task 10 technique: poke + pinch-ray, 0 draw calls).
 * It shows the screen for the current FlowState and turns pad presses into TrainerApp calls.
 */
import { Euler, Object3D, type Entity, type Vector3, type World } from '@iwsdk/core';
import type { Scenario } from '../../contracts/scenario';
import type { ElecMoment } from '../../engine/power';
import { HEAD_ANCHOR } from '../../xr/cockpit/layout';
import { ZoneCanvas } from '../../xr/panels/draw';
import { createPanelPad, type PanelPad } from '../../xr/panels/panelPad';
import { CREW_CAPTION_HEAD } from '../crewCaption';
import type { TrainerApp } from '../controller';
import type { DebriefRow } from '../debriefModel';
import type { FlowState } from '../flow';
import { briefingScreen } from './briefing';
import { drawCoach, type CoachLines } from './coach';
import { flightSelectScreen } from './flightSelect';
import { debriefPads, drawDebrief, layoutDebrief, type DebriefLayout } from './debrief';
import { ELEC_STRIP_H } from './elecDiagram';
import { SCREENS, SMALL_BUTTONS, type Rect, type ScreenSurface, type SmallButtonId } from './layout';
import { modeSelectScreen } from './modeSelect';
import { practiceScreen } from './practice';
import { finishedScreen, pausedScreen } from './status';
import { drawTimeline, layoutTimeline, timelinePads, timelineTitle, type TimelineLayout } from './timelineView';
import type { PadLevel, ScreenCtx, SmallScreen } from './ui';
import { welcomeScreen } from './welcome';

/** Quads sit just proud of the screen frame. */
const QUAD_Z = 0.0008;
/** Presses within this time after a screen change are ignored (the finger that pressed the last button). */
const ARM_MS = 450;

const SMALL: Partial<Record<FlowState, SmallScreen>> = {
  welcome: welcomeScreen,
  flightSelect: flightSelectScreen,
  modeSelect: modeSelectScreen,
  practice: practiceScreen,
  briefing: briefingScreen,
  paused: pausedScreen,
  finished: finishedScreen,
};

export interface ScreensHost {
  /**
   * Another flight was chosen (T41): the redo and timeline pads are mapped to its Event Set ids (`ui:redo:<setId>`) and the
   * screens that quote the scenario (practice prompt, finished) read it. Pads beyond its sets stay hidden.
   */
  setScenario(s: Scenario): void;
  /** Per frame: hover redraw gating + canvas redraw (<= 10 Hz, only when dirty). */
  tick(nowMs: number): void;
  /** Guided-flight coach strip text; null clears it. Shown only while the flow is running or redo. Same text never redraws. */
  setCoach(lines: CoachLines | null): void;
  setCrewCaption(text: string | null): void;
  /** Last content actually drawn on the visible strip; allocates only when read. */
  stripContent(): CoachLines | null;
  /** Dev/test: world position of a visible screen button (`ui:continue`, `ui:redo:<setId>`, ...). */
  targetPosition(id: string): [number, number, number] | undefined;
  /** performance.now() when the welcome screen was first drawn (cold-start measurement). */
  welcomeDrawnAt(): number | undefined;
  /** Runs `fn` once, right after the welcome screen is first drawn (at once if it already was). */
  onWelcomeDrawn(fn: () => void): void;
  /** Dev/test: what the debrief screen shows: 'grades' or 'timeline:<eventSetId>'. */
  debriefView(): string;
  /** Redraw the small screen: something it reads from outside the flow changed (T49: the sound-off line). */
  refresh(): void;
}

interface Surface {
  key: ScreenSurface;
  entity: Entity;
  zc: ZoneCanvas;
}

/** The seat offset the SEAT buttons change (T40): `step(1)` moves the eye back, `step(-1)` forward. */
export interface SeatControl {
  get(): number;
  step(dir: 1 | -1): void;
}

/**
 * `poolSize` is how many Event Sets the largest registered flight has (padPoolSize); the redo and timeline pads are created
 * once for that many and re-mapped to the active flight's set ids on every swap. It grows if a scenario needs more.
 */
export function createScreens(world: World, app: TrainerApp, scenario: Scenario, seat: SeatControl, poolSize = scenario.eventSets.length): ScreensHost {
  const surfaces = {} as Record<ScreenSurface, Surface>;
  for (const key of Object.keys(SCREENS) as ScreenSurface[]) {
    const s = SCREENS[key];
    const root = new Object3D();
    root.name = `screen:${key}`;
    root.position.set(HEAD_ANCHOR[0] + s.pos[0], HEAD_ANCHOR[1] + s.pos[1], HEAD_ANCHOR[2] + s.pos[2]);
    root.rotation.copy(new Euler(s.rotX ?? 0, s.rotY ?? 0, 0, 'YXZ'));
    const entity = world.createTransformEntity(root);
    const zc = new ZoneCanvas(s.size[0], s.size[1]);
    zc.panel.mesh.name = `panel:screen.${key}`;
    zc.panel.mesh.position.z = QUAD_Z;
    zc.panel.mesh.visible = false;
    root.add(zc.panel.mesh);
    surfaces[key] = { key, entity, zc };
  }

  let armedAt = 0;
  const onPress = (id: string) => {
    if (performance.now() < armedAt) return;
    if (id === 'continue') app.continue();
    else if (/^flight\d$/.test(id)) app.chooseFlight(app.flights[Number(id.slice(6))]?.id ?? '');
    else if (id === 'guided') app.chooseGuided();
    else if (id === 'auto') app.chooseAuto();
    else if (id === 'begin') app.begin();
    else if (id === 'resume') app.resume();
    else if (id === 'again' || id === 'restart') app.restart();
    else if (id === 'abandon') app.abandon();
    else if (id === 'finish') app.finish();
    else if (id === 'seatBack' || id === 'seatFwd') {
      seat.step(id === 'seatBack' ? 1 : -1);
      surfaces.small.zc.panel.markDirty();
    }
    else if (id === 'prev' || id === 'next') {
      const d = id === 'next' ? 1 : -1;
      if (view === 'grades') page = Math.max(0, Math.min((layout?.pages.length ?? 1) - 1, page + d));
      else tlPage = Math.max(0, Math.min((tl?.layout.pages.length ?? 1) - 1, tlPage + d));
      placePads();
      surfaces.large.zc.panel.markDirty();
    } else if (id.startsWith('redo:')) app.redo(id.slice(5));
    else if (id.startsWith('timeline:')) openTimeline(id.slice(9));
    else if (id === 'back') setView('grades');
  };

  // pad pool: small-screen buttons, debrief header buttons, and a Redo and a Timeline pad per Event Set slot
  const pads = new Map<string, { pad: PanelPad; surface: ScreenSurface }>();
  const addPad = (id: string, surface: ScreenSurface) =>
    pads.set(id, { pad: createPanelPad(world, surfaces[surface].entity, `screen.${id}`, () => onPress(id)), surface });
  for (const id of Object.keys(SMALL_BUTTONS)) addPad(id, 'small');
  for (const id of ['restart', 'finish', 'prev', 'next', 'back']) addPad(id, 'large');
  // The slots are created once. Which Event Set a slot stands for changes with the flight: the press reads `setIds` when it happens.
  let current = scenario;
  let setIds: string[] = [];
  const slots: Array<{ redo: PanelPad; timeline: PanelPad }> = [];
  const ensureSlots = (n: number) => {
    while (slots.length < n) {
      const i = slots.length;
      slots.push({
        redo: createPanelPad(world, surfaces.large.entity, `screen.redo.${i}`, () => onPress(`redo:${setIds[i]}`)),
        timeline: createPanelPad(world, surfaces.large.entity, `screen.timeline.${i}`, () => onPress(`timeline:${setIds[i]}`)),
      });
    }
  };
  const mapSets = (s: Scenario) => {
    for (const k of [...pads.keys()]) if (k.startsWith('redo:') || k.startsWith('timeline:')) pads.delete(k);
    for (const sl of slots) {
      sl.redo.hide();
      sl.timeline.hide();
    }
    setIds = s.eventSets.map((e) => e.id);
    ensureSlots(setIds.length);
    setIds.forEach((id, i) => {
      pads.set(`redo:${id}`, { pad: slots[i].redo, surface: 'large' });
      pads.set(`timeline:${id}`, { pad: slots[i].timeline, surface: 'large' });
    });
  };
  ensureSlots(poolSize);
  mapSets(scenario);

  const level = (id: string): PadLevel => {
    const p = pads.get(id)?.pad;
    if (!p) return 'idle';
    return p.press() > 0.5 ? 'press' : p.hover() > 0.5 ? 'hover' : 'idle';
  };
  const ctx: ScreenCtx = {
    get scenario() {
      return current;
    },
    get flights() {
      return app.flights;
    },
    get flight() {
      return app.flight;
    },
    level,
    seatOffset: () => seat.get(),
  };

  let state: FlowState = app.state;
  let rows: DebriefRow[] = [];
  let layout: DebriefLayout | undefined;
  let page = 0;
  /** The large screen shows the grades, or one Event Set's timeline. Reset to the grades whenever the debrief is shown. */
  let view: 'grades' | { eventSetId: string } = 'grades';
  let tl: { eventSetId: string; title: string; attempt: 'first' | 'redo'; layout: TimelineLayout; elec: ElecMoment[] | null } | undefined;
  let tlPage = 0;
  let shown: Array<{ id: string; rect: Rect }> = [];
  let welcomeAt: number | undefined;
  const welcomeWaiters: Array<() => void> = [];
  let coach: CoachLines | null = null;
  let crewText: string | null = null;
  let drawnHead: string | null = null;
  let drawnBody = '';
  const crewLines: CoachLines = { head: CREW_CAPTION_HEAD, body: '' };
  const coachVisible = () => (coach !== null || crewText !== null) && (state === 'running' || state === 'redo');

  const placePads = () => {
    if (state === 'debrief' && view !== 'grades' && tl) shown = timelinePads(tl.layout, tlPage);
    else if (state === 'debrief' && layout) shown = debriefPads(rows, layout, page);
    else {
      const scr = SMALL[state];
      shown = scr?.pads ? [...scr.pads(ctx)] : (scr?.buttons ?? []).map((id) => ({ id, rect: SMALL_BUTTONS[id as SmallButtonId] }));
    }
    for (const [id, { pad }] of pads) {
      const s = shown.find((x) => x.id === id);
      if (s) pad.rect(s.rect.cx, s.rect.cy, s.rect.w, s.rect.h);
      else pad.hide();
    }
  };

  /** Switching the large screen's view re-arms the press guard: BACK and FINISH share a spot, as do PREV and NEXT. */
  const setView = (v: 'grades' | { eventSetId: string }) => {
    view = v;
    armedAt = performance.now() + ARM_MS;
    placePads();
    surfaces.large.zc.panel.markDirty();
  };
  const openTimeline = (eventSetId: string) => {
    const r = app.review(eventSetId);
    if (!r) return;
    const n = rows.findIndex((x) => x.eventSetId === eventSetId);
    const zc = surfaces.large.zc;
    tl = {
      eventSetId,
      title: timelineTitle(n + 1, n >= 0 ? rows[n].title : eventSetId),
      attempt: r.attempt,
      layout: layoutTimeline(r.review.entries, (t, weight) => zc.measure(t, 'body', weight), r.review.elec ? ELEC_STRIP_H : 0),
      elec: r.review.elec,
    };
    tlPage = 0;
    setView({ eventSetId });
  };

  surfaces.small.zc.panel.setDraw(() => {
    const scr = SMALL[state];
    if (!scr) return;
    scr.draw(surfaces.small.zc, ctx);
    if (state === 'welcome' && welcomeAt === undefined) {
      welcomeAt = performance.now();
      for (const fn of welcomeWaiters.splice(0)) fn();
    }
  });
  surfaces.large.zc.panel.setDraw(() => {
    if (view !== 'grades' && tl) drawTimeline(surfaces.large.zc, { title: tl.title, attempt: tl.attempt, layout: tl.layout, page: tlPage, elec: tl.elec, level });
    else if (layout) drawDebrief(surfaces.large.zc, { rows, layout, page, guided: app.guided, level });
  });

  surfaces.coach.zc.panel.setDraw(() => {
    const lines = coach ?? (crewText === null ? null : crewLines);
    if (lines) {
      drawCoach(surfaces.coach.zc, lines);
      drawnHead = lines.head;
      drawnBody = lines.body;
    }
  });

  const show = (s: FlowState) => {
    state = s;
    armedAt = performance.now() + ARM_MS;
    if (s === 'debrief') {
      rows = app.debrief();
      const zc = surfaces.large.zc;
      layout = layoutDebrief(rows, (t, role, weight) => {
        void role;
        return zc.measure(t, 'body', weight);
      });
      page = 0;
      view = 'grades';
      tl = undefined;
      tlPage = 0;
    }
    surfaces.small.zc.panel.mesh.visible = SMALL[s] !== undefined;
    surfaces.large.zc.panel.mesh.visible = s === 'debrief';
    surfaces.coach.zc.panel.mesh.visible = coachVisible();
    surfaces.coach.zc.panel.markDirty();
    placePads();
    surfaces.small.zc.panel.markDirty();
    surfaces.large.zc.panel.markDirty();
  };
  app.onChange(show);
  show(app.state);

  let sig = '';
  return {
    setScenario(next) {
      current = next;
      mapSets(next);
      placePads();
      surfaces.small.zc.panel.markDirty();
    },
    tick(nowMs) {
      let s = '';
      for (const b of shown) s += level(b.id)[0];
      if (s !== sig) {
        sig = s;
        surfaces.small.zc.panel.markDirty();
        surfaces.large.zc.panel.markDirty();
      }
      if (surfaces.small.zc.panel.mesh.visible) surfaces.small.zc.panel.tick(nowMs);
      if (surfaces.large.zc.panel.mesh.visible) surfaces.large.zc.panel.tick(nowMs);
      if (surfaces.coach.zc.panel.mesh.visible) surfaces.coach.zc.panel.tick(nowMs);
    },
    setCoach(lines) {
      const same = lines === null ? coach === null : coach !== null && coach.head === lines.head && coach.body === lines.body;
      if (same) return;
      coach = lines === null ? null : { head: lines.head, body: lines.body };
      surfaces.coach.zc.panel.mesh.visible = coachVisible();
      surfaces.coach.zc.panel.markDirty();
    },
    setCrewCaption(text) {
      if (crewText === text) return;
      crewText = text;
      crewLines.body = text ?? '';
      if (coach !== null) return;
      surfaces.coach.zc.panel.mesh.visible = coachVisible();
      surfaces.coach.zc.panel.markDirty();
    },
    stripContent() {
      return surfaces.coach.zc.panel.mesh.visible && drawnHead !== null ? { head: drawnHead, body: drawnBody } : null;
    },
    targetPosition(id) {
      if (!id.startsWith('ui:')) return undefined;
      let key = id.slice(3);
      if (key.startsWith('flight:')) key = `flight${app.flights.findIndex((f) => f.id === key.slice(7))}`; // ui:flight:<flightId> -> the card slot
      // ui:restart is the debrief's RESTART or the finished screen's, whichever is shown
      for (const k of key === 'restart' ? ['restart', 'again'] : [key]) {
        const v: Vector3 | undefined = pads.get(k)?.pad.front();
        if (v) return [v.x, v.y, v.z];
      }
      return undefined;
    },
    welcomeDrawnAt: () => welcomeAt,
    onWelcomeDrawn(fn) { if (welcomeAt !== undefined) fn(); else welcomeWaiters.push(fn); },
    debriefView: () => (view === 'grades' ? 'grades' : `timeline:${view.eventSetId}`),
    refresh: () => surfaces.small.zc.panel.markDirty(),
  };
}
