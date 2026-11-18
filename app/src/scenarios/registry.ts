/**
 * Flight registry (plan 2026-11-15): the flights a user can choose, and how to build each one. Pure data: no IWSDK or
 * DOM imports, so the tools and the node tests can load it. The scenario-content lane edits the entries; the app
 * only reads them.
 */
import type { Scenario } from '../contracts/scenario';
import { buildSingleSource, SINGLE_SOURCE_VARIATIONS } from './single-source';
import { crossCheck } from './cross-check';
import { timeCritical } from './time-critical';

export interface FlightDef {
  id: string;
  /** Shown on the picker card. Plain ASCII. */
  title: string;
  /** One line under the title. Plain ASCII. */
  blurb: string;
  minutes: number;
  /** GUIDED FLIGHT is offered: the scenario has guide steps. */
  guided: boolean;
  /** At least 1. Index 0 is the baseline. */
  variations: number;
  build(variation: number): Scenario;
}

export const FLIGHTS: readonly FlightDef[] = [
  { id: 'single-source', title: 'Single Source', blurb: 'A generator fails over open water', minutes: 10, guided: true, variations: SINGLE_SOURCE_VARIATIONS.length, build: buildSingleSource },
  { id: 'time-critical', title: 'Time Critical', blurb: 'A passenger collapses in cruise', minutes: 7, guided: false, variations: 1, build: (index) => {
    if (index !== 0) throw new RangeError(`Invalid Time Critical variation: ${index}`);
    return timeCritical;
  } },
  { id: 'cross-check', title: 'Cross-Check', blurb: 'A late change and a busy frequency', minutes: 6, guided: false, variations: 1, build: (index) => {
    if (index !== 0) throw new RangeError(`Invalid Cross-Check variation: ${index}`);
    return crossCheck;
  } },
];

export function flightById(id: string): FlightDef | undefined {
  return FLIGHTS.find((f) => f.id === id);
}

/** A variation index in [0, count); never `last` when count > 1. `rnd` returns a number in [0, 1). */
export function pickVariation(count: number, last: number | null, rnd: () => number): number {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return 0;
  const skip = last !== null && Number.isInteger(last) && last >= 0 && last < n;
  const r = Math.min(Math.max(rnd(), 0), 1 - Number.EPSILON);
  if (!skip) return Math.floor(r * n);
  const i = Math.floor(r * (n - 1));
  return i >= last ? i + 1 : i;
}

/** Every flight and variation, the first flight's baseline first. Used by the audio catalog and the tools. */
export function allScenarios(): Scenario[] {
  return FLIGHTS.flatMap((f) => Array.from({ length: f.variations }, (_, v) => f.build(v)));
}
