/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetManager, AudioListener, Object3D, World, type Entity } from '@iwsdk/core';
import assets from './assets';
import { voiceAssetIds } from './xr/audioAssets';
import { loadInOrder } from './xr/voiceLoader';
import projectOptions from 'virtual:iwsdk-project';
import { HEAD_ANCHOR, CREW_VOICE_POS } from './xr/cockpit/layout';
import { EventBus } from './bus/eventBus';
import type { PilotAction } from './contracts/events';
import { buildCockpit, builtZoneEntities } from './xr/cockpit/buildCockpit';
import { createTrainerAudio, type TrainerAudio } from './xr/audio';
import { createAudioBackend } from './xr/audioBackend';
import { bindTrainerAudio } from './xr/audioBinding';
import { onControlClick } from './xr/controls/controlBase';
import { isLive } from './app/flow';
import { CockpitControlSystem } from './xr/controls/controlSystem';
import { PointerUnstickSystem } from './xr/controls/pointerUnstick';
import { SeatSystem, getSeatOffset, setSeatOffset } from './xr/seatSystem';
import { loadSeatOffset, saveSeatOffset } from './app/seatPref';
import { stepSeat } from './xr/seatMath';
import { DevFlowState } from './xr/controls/components';
import { OutsideSystem, createOutside, setOutsideFlight, type Outside } from './xr/outside/sky';
import { DisplaysSystem, createDisplays, type Displays } from './xr/displays';
import { PanelsSystem, createPanels, type Panels } from './xr/panels';
import { FLIGHTS } from './scenarios/registry';
import { devSecondFlight, parseFlightOverride, startingPoint } from './app/flightOverride';
import type { FlightDef } from './scenarios/registry';
import { TrainerApp } from './app/controller';
import { AppFlowSystem, setAppForSystem } from './app/appSystem';
import { createScreens, type ScreensHost } from './app/screens/host';
import { padPoolSize } from './app/screens/layout';
import { guideWorldFromModels } from './app/guide';
import { padFront } from './xr/controls/controlBase';
import { createGuideFrames, type GuideFrames } from './xr/guide/frames';
import { GuideSystem, setGuideDeps } from './xr/guide/guideSystem';
import type { GuidePanels } from './xr/guide/resolve';
import { installPerf } from './dev/perf';
import { installPageFooter } from './app/pageFooter';
import { installPageGestureUnlock, installSessionGestureUnlock } from './app/audioUnlock';
import { installStartButton } from './app/startButton';
import { setSoundOff } from './app/soundState';

installPageFooter(); // build stamp on the 2D page, before the world exists (T37)
setSeatOffset(loadSeatOffset()); // T40: the remembered seat distance, before the first session anchors
// T49: the shared AudioContext only resumes inside a user activation, and the Quest Browser's own Enter VR button gives the
// page none. Any tap, click or key on the page resumes it (synchronously: the activation does not outlive the handler).
// Bound late: a tap before the world exists still counts, as sticky activation, for the resume that follows.
let unlockAudio: () => void = () => {};
installPageGestureUnlock(() => unlockAudio());

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // The single in-headset channel: cockpit/panels emit actions, the Auto runner forwards session cues.
  const bus = new EventBus();
  world.registerSystem(SeatSystem); // T37: puts the cockpit around the user's head when the immersive session starts
  world.registerSystem(AppFlowSystem);
  world.registerSystem(GuideSystem);
  world.registerSystem(CockpitControlSystem);
  world.registerSystem(PointerUnstickSystem); // T23: releases a ray press the SDK left stuck, so pokes keep working
  world.registerSystem(DisplaysSystem);
  world.registerSystem(PanelsSystem);
  world.registerSystem(OutsideSystem);
  const controls = buildCockpit(world, bus);
  const displays = createDisplays(world, bus, controls);
  // Dev only (stripped from production builds): ?flight=<id>&variation=<n> opens the app in that flight and pins the variation.
  const override = import.meta.env.MODE !== 'production' ? parseFlightOverride(location.search, FLIGHTS) : undefined;
  // Dev only: ?flights=2 registers a second, unguided flight so the picker can be driven by hand.
  const flights: readonly FlightDef[] = override?.extraFlight ? [...FLIGHTS, devSecondFlight(FLIGHTS[0])] : FLIGHTS;
  const start = startingPoint(flights, override);
  const panels = createPanels(world, bus, start.flight.build(start.variation));
  const outside = createOutside(world);

  // Reuse IWSDK's existing listener and the actual comms face; all buffers are already cached.
  let listener: AudioListener | undefined;
  world.player.head.traverse((node) => { if (node instanceof AudioListener) listener = node; });
  const commsFace = builtZoneEntities.comms?.object3D?.getObjectByName('panel:comms');
  const crewSeat = new Object3D();
  crewSeat.name = 'crew-voice-anchor';
  crewSeat.position.set(HEAD_ANCHOR[0] + CREW_VOICE_POS[0], HEAD_ANCHOR[1] + CREW_VOICE_POS[1], HEAD_ANCHOR[2] + CREW_VOICE_POS[2]);
  world.createTransformEntity(crewSeat);
  let audio: TrainerAudio | undefined;
  if (listener && commsFace) {
    const playback = createTrainerAudio(createAudioBackend(listener, commsFace, crewSeat), { onError: (error) => { if (import.meta.env.MODE !== 'production') console.warn('Audio playback unavailable:', error); } });
    const binding = bindTrainerAudio(bus, playback, onControlClick, () => isLive(app.state));
    audio = { ...playback, reset: binding.reset, endRun: binding.endRun, dispose: binding.dispose };
  } else if (import.meta.env.MODE !== 'production') console.warn('Audio anchor unavailable; scenario text remains usable.');
  unlockAudio = () => { void audio?.unlock(); };
  // Hand poke is not a DOM activation: reuse IWSDK AudioSystem's XR session unlock path. A pinch (WebXR select) is tried too:
  // the select events are activation-triggering, but whether the Quest Browser honours that for audio is unverified (T49).
  world.renderer.xr.addEventListener('sessionstart', () => {
    unlockAudio();
    installSessionGestureUnlock(world.renderer.xr.getSession(), unlockAudio);
  });
  if (world.renderer.xr.isPresenting) { unlockAudio(); installSessionGestureUnlock(world.renderer.xr.getSession(), unlockAudio); }
  setSoundOff(!!listener && listener.context.state !== 'running'); // the welcome screen's "Sound is off" line

  // Task 11: flow + Auto wiring. Virtual briefing room (F29 passthrough not wired: see app/briefingMode.ts).
  const guideWorld = guideWorldFromModels(panels.comms.model, panels.checklist.model, () => displays.alerts.list);
  const app = new TrainerApp({ flights, devOverride: override, bus, panels, displays, controls, audio, guideWorld });
  // T40: SEAT FWD / SEAT BACK on the welcome and paused screens. Each press moves the seat one step and remembers it.
  const seat = {
    get: getSeatOffset,
    step(dir: 1 | -1) {
      setSeatOffset(stepSeat(getSeatOffset(), dir));
      saveSeatOffset(getSeatOffset());
    },
  };
  const screens = createScreens(world, app, app.scenario, seat, padPoolSize(flights));
  app.onScenarioChange((s) => screens.setScenario(s)); // T41: another flight was chosen
  // T49: keep the welcome screen's "Sound is off" line in step with the shared AudioContext. A context that starts by itself (no
  // gesture of ours) still has to unlock the playback layer, or it would stay silent.
  listener?.context.addEventListener('statechange', () => {
    const running = listener!.context.state === 'running';
    if (running) unlockAudio();
    if (setSoundOff(!running)) screens.refresh();
  });
  // T49: the 2D page's Start button: a real click, so audio resumes (sync, inside the click) and then XR launches. The browser's
  // own offered Enter VR stays: launchXR and the pending offerSession both end up in adoptXRSession, where the first session wins.
  const startButton = installStartButton({
    available: !!navigator.xr,
    onStart: () => {
      unlockAudio();
      if (!world.session && !world.sessionRequestPending) world.launchXR();
    },
  });
  screens.onWelcomeDrawn(() => startButton.setReady());
  world.renderer.xr.addEventListener('sessionstart', () => startButton.setPresenting(true));
  world.renderer.xr.addEventListener('sessionend', () => startButton.setPresenting(false));
  if (world.renderer.xr.isPresenting) startButton.setPresenting(true);
  // Voice clips are lazy catalog entries: they load once, after the welcome screen is first drawn, in catalog order (baseline flight
  // first), four at a time. Until a clip arrives its line is a caption only. Not repeated on RESTART or a flight swap.
  screens.onWelcomeDrawn(() => {
    setTimeout(() => { // outside the draw call, so no work lands in a frame
      void loadInOrder(voiceAssetIds(assets), (id) => AssetManager.loadAudioById(id), 4).then(({ failed }) => {
        if (import.meta.env.MODE !== 'production' && failed.length) console.warn(`Voice clips that did not load (${failed.length}):`, failed);
      });
    }, 0);
  });
  // The outside view leaves the runway behind once the aircraft is off the ground (T37).
  setOutsideFlight(() => app.session.engine.state.phase !== 'holding');
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) app.visibility('hidden');
    else audio?.dispose();
  });
  // Pause when the immersive view is blurred / left, or the page is hidden. Resume is by hand only.
  world.visibilityState.subscribe((v) => app.visibility(v));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.visibility('hidden');
  });

  const frames = createGuideFrames(world);
  const guidePanels: GuidePanels = {
    comms: {
      pendingCards: () => panels.comms.model.pendingCards(),
      placementOf: (cardId, messageId) => panels.comms.placementOf(cardId, messageId),
      currentPage: () => panels.comms.currentPage(),
      pagePadName: (page) => panels.comms.pagePadName(page),
    },
    checklist: { rowOf: (itemId) => panels.checklist.rowOf(itemId), pageIndex: () => panels.checklist.pageIndex() },
  };
  setGuideDeps({ app, frames, screens, panels: guidePanels });

  const dev = import.meta.env.MODE !== 'production' ? installDevHooks(world, app, screens, bus, frames, outside, panels, displays) : undefined;
  setAppForSystem(app, screens, dev);
  // Dev only (T49): the shared AudioContext, so the emulator spec can read its state and suspend it to stand in for a locked headset.
  if (dev) (globalThis as unknown as { __trainer: Record<string, unknown> }).__trainer.audioContext = () => listener?.context;

  // Dev only: ?demo=displays animates AircraftState (stripped from production builds).
  if (import.meta.env.MODE !== 'production' && new URLSearchParams(location.search).get('demo') === 'displays') {
    import('./xr/displays/demo').then((m) => m.startDisplaysDemo(world, displays, bus));
  }
  // Dev only: ?demo=panels feeds real single-source cues into the panels (stripped from production builds).
  if (import.meta.env.MODE !== 'production' && new URLSearchParams(location.search).get('demo') === 'panels') {
    import('./xr/panels/demo').then((m) => m.startPanelsDemo(panels, bus));
  }
});

/**
 * Dev only: window.__trainer.flow() / session() / app.* / act(), ui:<buttonId> targets (wrapping the panels'
 * targetPosition) and an ECS-readable `dev-flow-state` entity. Returns a per-frame sync callback.
 */
function installDevHooks(world: World, app: TrainerApp, screens: ScreensHost, bus: EventBus, frames: GuideFrames, outside: Outside, panels: Panels, displays: Displays): (nowMs: number) => void {
  const o = new Object3D();
  o.name = 'dev-flow-state';
  const entity: Entity = world.createTransformEntity(o);
  entity.addComponent(DevFlowState, { flow: '', eventSet: '', grades: '' });
  let maxFlyingDrawCalls = 0;
  let flyingDrawSamples = 0;
  const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
  const perf = installPerf(world); // window.__trainer.perf(); ?perf=1 shows the overlay
  const prevTarget = g.__trainer?.targetPosition as ((id: string) => [number, number, number]) | undefined;
  g.__trainer = {
    ...g.__trainer,
    /** Panel targets (Task 10) plus the trainer screens: ui:continue, ui:flight:<flightId>, ui:auto, ui:guided, ui:begin, ui:resume, ui:seatFwd, ui:seatBack, ui:redo:<setId>, ui:restart, ui:finish, ui:prev, ui:next. */
    targetPosition(id: string): [number, number, number] {
      if (id.startsWith('guide:')) {
        const pad = frames.framedPad(Number(id.slice(6)));
        if (!pad) throw new Error(`unknown or hidden target '${id}'`);
        const p = padFront(pad);
        return [p.x, p.y, p.z];
      }
      if (id.startsWith('ui:')) {
        const p = screens.targetPosition(id);
        if (!p) throw new Error(`unknown or hidden screen target '${id}'`);
        return p;
      }
      if (!prevTarget) throw new Error(`unknown target '${id}'`);
      return prevTarget(id);
    },
    flow: () => app.state,
    /** The flight and variation of the scenario being flown (T41). */
    flight: () => ({ id: app.activeFlight.id, variation: app.variation }),
    /** What the panels hold right now (T41): the swap tests compare it with the scenario's own text. Read-only. */
    panelContent: () => ({
      briefing: panels.kneeboard.model.entries().map((e) => ({ id: e.id, title: e.title, body: e.body })),
      checklists: panels.checklist.model.titles(),
      openChecklist: panels.checklist.model.current()?.title ?? null,
      ticked: panels.checklist.model.tickOrder(),
      route: panels.route.model.rows().map((r) => r.name),
      messages: panels.comms.model.lastMessages(50).map((m) => m.text),
      alerts: displays.alerts.list.map((a) => a.id),
    }),
    /** What the debrief screen shows: 'grades' or 'timeline:<eventSetId>'. */
    debriefView: () => screens.debriefView(),
    /** The timeline record of one Event Set as the debrief would show it (the redo's when a redo exists), or null. */
    review: (id: string) => app.review(id),
    /** Guided flight: the current step and the pads framed right now, or null. */
    guide: () => {
      const v = app.guide();
      return v ? { stepId: v.stepId, waiting: v.waiting, text: v.text, pads: frames.framedNames() } : null;
    },
    /** Rendered strip content, distinct from the independent crew-caption state. */
    crewCaption: () => screens.stripContent(),
    rawCrewCaption: () => app.crewCaption.current(performance.now()),
    flyingDrawCalls: () => ({ max: maxFlyingDrawCalls, samples: flyingDrawSamples }),
    /** Live AircraftState of the engine (read-only use). */
    aircraft: () => app.session.engine.state,
    /** Actions the engine has recorded in the current Event Set (what the engine really received). */
    engineActions: () => app.session.engine.actionsFor(app.session.engine.status.eventSetId ?? '').map((a) => a.body),
    session: () => ({ flow: app.state, status: app.session.engine.status, results: app.results(), debrief: app.debrief() }),
    /** Fallback drivers (Task 13 may use them; a hand-driven proof must not). */
    app: {
      continue: () => app.continue(),
      chooseFlight: (id: string) => app.chooseFlight(id),
      chooseAuto: () => app.chooseAuto(),
      chooseGuided: () => app.chooseGuided(),
      begin: () => app.begin(),
      pause: () => app.pause(),
      resume: () => app.resume(),
      redo: (id: string) => app.redo(id),
      restart: () => app.restart(),
      finish: () => app.finish(),
    },
    act: (a: PilotAction) => bus.emitAction(a),
    /** ms from navigation start to the first welcome-screen draw. */
    coldStartMs: () => screens.welcomeDrawnAt(),
    /** Seat anchoring (T37): the player rig's offset from the tracking space. All zero when the emulated head started on HEAD_ANCHOR. */
    seat: () => ({ position: world.player.position.toArray(), yaw: world.player.rotation.y }),
    /** Outside view (T37): 0 = runway picture, 1 = above the cloud; groundVisible is false once the runway is gone. */
    outside: () => outside.flight(),
    /** Where the tracked head is in the WORLD, and which way it faces (unit vector). Read-only. */
    headWorld: () => {
      world.player.updateMatrixWorld(true);
      const m = world.player.head.matrixWorld.elements;
      return { position: [m[12], m[13], m[14]], forward: [-m[8], -m[9], -m[10]] };
    },
    /** Draw calls of the last rendered frame (in XR: both eyes). Read-only measurement. */
    drawCalls: () => world.renderer.info.render.calls,
  };
  let last = '';
  let lastAt = 0;
  return (now) => {
    perf.frame(now);
    if (isLive(app.state) && world.renderer.xr.isPresenting) {
      maxFlyingDrawCalls = Math.max(maxFlyingDrawCalls, world.renderer.info.render.calls);
      flyingDrawSamples++;
    }
    if (now - lastAt < 200) return;
    lastAt = now;
    const st = app.session.engine.status;
    const grades = app.state === 'debrief' || app.state === 'finished' ? app.debrief().map((r) => `${r.eventSetId}:${r.grade}${r.redoGrade !== undefined ? `>${r.redoGrade}` : ''}${r.hintUsed ? 'h' : ''}`).join(';') : '';
    const snap = `${app.state}|${st.eventSetId ?? ''}|${grades}`;
    if (snap === last) return;
    last = snap;
    entity.setValue(DevFlowState, 'flow', app.state);
    entity.setValue(DevFlowState, 'eventSet', st.eventSetId ?? '');
    entity.setValue(DevFlowState, 'grades', grades);
  };
}
