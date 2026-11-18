// Pure aircraft-state functions. No rendering imports: runs headless in Node.
import type { AircraftPatch, AircraftState } from '../contracts/aircraft';
import type { PilotAction } from '../contracts/events';

const HDG_RATE_DEG_PER_SEC = 3;
const CLIMB_RATE_FT_PER_SEC = 2500 / 60;

const norm360 = (d: number): number => ((d % 360) + 360) % 360;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch) || !isPlainObject(target)) return structuredClone(patch);
  const out: Record<string, unknown> = { ...structuredClone(target) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = k in out ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

export function applyPatch(s: AircraftState, p: AircraftPatch): AircraftState {
  return deepMerge(s, p) as AircraftState;
}

export function applyControl(s: AircraftState, a: Extract<PilotAction, { kind: 'control' }>): AircraftState {
  const n = structuredClone(s);
  const v = a.value;
  switch (a.controlId) {
    case 'ap.hdg': n.ap.hdg = norm360(v as number); break;
    case 'ap.alt': n.ap.alt = v as number; break;
    case 'ap.engage': n.ap.engaged = v as boolean; break;
    case 'ap.lateral': n.ap.lateral = v as AircraftState['ap']['lateral']; break;
    case 'ap.vertical': n.ap.vertical = v as AircraftState['ap']['vertical']; break;
    case 'baro.set': n.baroHpa = v as number; break;
    case 'lights.landing': n.lights.landing = v as boolean; break;
    case 'lights.strobe': n.lights.strobe = v as boolean; break;
    case 'elec.gen1': n.elec.gen1.switchOn = v as boolean; break;
    case 'elec.gen2': n.elec.gen2.switchOn = v as boolean; break;
    case 'elec.busTie': n.elec.busTie = v as boolean; break;
    case 'radio.com1': n.comFreq = v as string; break;
    case 'route.destination': n.destination = v as string; break;
    case 'pa.cabin':
    case 'practice.toggle':
      break;
  }
  return n;
}

export function stepAircraft(s: AircraftState, dtSimSec: number): AircraftState {
  const n = structuredClone(s);
  if (n.phase === 'holding') return n;

  if (n.ap.engaged) {
    const diff = norm360(n.ap.hdg - n.headingDeg + 180) - 180; // signed shortest, [-180,180)
    const maxTurn = HDG_RATE_DEG_PER_SEC * dtSimSec;
    n.headingDeg = Math.abs(diff) <= maxTurn ? n.ap.hdg : n.headingDeg + Math.sign(diff) * maxTurn;
  }
  n.headingDeg = norm360(n.headingDeg);

  if (n.ap.engaged && n.ap.vertical === 'climb') {
    const diff = n.ap.alt - n.altitudeFt;
    const maxMove = CLIMB_RATE_FT_PER_SEC * dtSimSec;
    n.altitudeFt = Math.abs(diff) <= maxMove ? n.ap.alt : n.altitudeFt + Math.sign(diff) * maxMove;
  }

  if (n.altitudeFt > 50 && n.phase === 'takeoff') n.phase = 'climb';
  if (Math.abs(n.altitudeFt - n.ap.alt) <= 100 && n.altitudeFt > 10000) n.phase = 'cruise';
  return n;
}

export function readPath(s: AircraftState, path: string): unknown {
  let cur: unknown = s;
  for (const key of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}
