/**
 * DEV ONLY demo driver (`?demo=displays`): animates an AircraftState so the displays can be checked in the
 * emulator before the engine is wired (Task 11). Holding -> takeoff -> climb 0..12000 ft, heading 090 -> 120,
 * storm bearing set during the climb, and at 10000 ft a gen1-fail warning cue plus gen1.failed. Starts when
 * the immersive session becomes visible (or via window.__trainer.demo.start()). Not used in production builds.
 */
import { VisibilityState, type World } from '@iwsdk/core';
import type { AircraftState } from '../../contracts/aircraft';
import type { EventBus } from '../../bus/eventBus';
import type { Displays } from './index';

const HOLD_S = 4;
const TAKEOFF_S = 5;
const CLIMB_S = 40;
const ALERT_ALT_FT = 10000;

export function initialDemoState(): AircraftState {
  return {
    altitudeFt: 0, headingDeg: 90, speedKt: 0, phase: 'holding',
    ap: { engaged: false, hdg: 90, alt: 12000, lateral: 'hdg', vertical: 'climb' },
    baroHpa: 1013, lights: { landing: false, strobe: false },
    elec: { gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false }, backupGenInop: true, busTie: false },
    comFreq: '118.65', destination: 'dest', stormBearingDeg: null,
  };
}

/** Pure timeline: fills `s` for `t` seconds after the demo started. Returns true once the gen1 alert should fire. */
export function demoStep(s: AircraftState, t: number): boolean {
  let fire = false;
  if (t < HOLD_S) {
    Object.assign(s, { phase: 'holding', altitudeFt: 0, speedKt: 0, headingDeg: 90 });
  } else if (t < HOLD_S + TAKEOFF_S) {
    const k = (t - HOLD_S) / TAKEOFF_S;
    Object.assign(s, { phase: 'takeoff', altitudeFt: 400 * k * k, speedKt: 150 * k, headingDeg: 90 });
  } else {
    const k = Math.min(1, (t - HOLD_S - TAKEOFF_S) / CLIMB_S);
    Object.assign(s, { phase: k >= 1 ? 'cruise' : 'climb', altitudeFt: 400 + 11600 * k, speedKt: 150 + 130 * k, headingDeg: 90 + 30 * k });
    s.ap.engaged = true;
    s.ap.hdg = 120;
    s.stormBearingDeg = 150;
    if (s.altitudeFt >= ALERT_ALT_FT && !s.elec.gen1.failed) {
      s.elec.gen1.failed = true;
      fire = true;
    }
  }
  return fire;
}

export function startDisplaysDemo(world: World, displays: Displays, bus: EventBus): void {
  const state = initialDemoState();
  displays.setAirportNames({ dest: 'Harrowmere', dep: 'Quillby Fell' });
  let t0: number | null = null;
  let seq = 0;
  displays.setAircraft(state);
  displays.addTicker((now) => {
    if (t0 === null) return;
    if (demoStep(state, (now - t0) / 1000))
      bus.emitCue({ t: 0, seq: ++seq, body: { kind: 'alert', id: 'gen1-fail', level: 'warning', text: 'GEN 1 FAIL' } });
    displays.setAircraft(state);
  });
  const start = () => {
    if (t0 === null) t0 = performance.now();
  };
  world.visibilityState.subscribe((v) => {
    if (v !== VisibilityState.NonImmersive) start();
  });
  const g = globalThis as unknown as { __trainer?: Record<string, unknown> };
  g.__trainer = { ...g.__trainer, demo: { start, state } };
}
