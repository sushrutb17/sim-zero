/**
 * Dev-only `?flight=<id>&variation=<n>` (T41): opens the app in that flight and pins the variation, so the emulator specs are
 * deterministic. `?flights=2` also registers a second, unguided flight (devSecondFlight), so the picker can be exercised by
 * hand while the real registry holds one flight. Pure. index.ts calls it only when `import.meta.env.MODE !== 'production'`, so neither this code nor the
 * parameter names reach a production bundle.
 */
import type { FlightDef } from '../scenarios/registry';

export interface FlightOverride {
  flight?: string;
  variation?: number;
  /** `?flights=2`: add devSecondFlight to the registered flights. */
  extraFlight?: boolean;
}

/** What `search` asks for. A parameter that names no registered flight, or a variation outside the flight's range, is ignored. */
export function parseFlightOverride(search: string, flights: ReadonlyArray<{ id: string; variations: number }>): FlightOverride {
  const q = new URLSearchParams(search);
  const out: FlightOverride = {};
  const flightId = q.get('flight');
  const flight = flightId === null ? flights[0] : flights.find((f) => f.id === flightId);
  if (flightId !== null && flight) out.flight = flight.id;
  if (q.get('flights') === '2') out.extraFlight = true;
  const raw = q.get('variation');
  if (raw !== null && /^\d{1,6}$/.test(raw) && flight && Number(raw) < flight.variations) out.variation = Number(raw);
  return out;
}

/** The flight and variation the app opens with: the override's when it names them, else the first flight's baseline. */
export function startingPoint<F extends { id: string; variations: number }>(flights: readonly F[], ov?: FlightOverride): { flight: F; variation: number } {
  const flight = (ov?.flight !== undefined ? flights.find((f) => f.id === ov.flight) : undefined) ?? flights[0];
  const v = ov?.variation;
  return { flight, variation: v !== undefined && Number.isInteger(v) && v >= 0 && v < flight.variations ? v : 0 };
}

/** Which Single Source variation the dev second flight plays: failed generator 2, so its checklist and alerts differ from the baseline's. */
export const DEV_SECOND_VARIATION = 6;

/** A second flight for the emulator specs: `base` at a fixed variation, no guide, one variation. Dev builds only. */
export function devSecondFlight(base: FlightDef): FlightDef {
  const v = Math.min(DEV_SECOND_VARIATION, base.variations - 1);
  return { ...base, id: 'dev-second', title: 'Second flight', blurb: 'Dev only: the same flight, another variation', minutes: 10, guided: false, variations: 1, build: () => base.build(v) };
}
