// Pure electrical rule, caption and review moments. No rendering imports: runs headless in Node.
// The power rule used to live in the overhead panel; it moved here so the debrief can use it too.
import type { AircraftState, GenState } from '../contracts/aircraft';
import type { SetHistory } from './conditions';

export type Elec = AircraftState['elec'];

/** A generator is online when its switch is on and it has not failed. */
export function genOnline(g: GenState): boolean {
  return g.switchOn && !g.failed;
}

/** Bus power: each bus is fed by its own generator, or by the other generator through the bus tie. */
export function busStatus(e: Elec): { bus1: boolean; bus2: boolean } {
  const g1 = genOnline(e.gen1);
  const g2 = genOnline(e.gen2);
  return { bus1: g1 || (e.busTie && g2), bus2: g2 || (e.busTie && g1) };
}

/** One plain sentence saying where the power comes from. Printable ASCII. */
export function elecCaption(e: Elec): string {
  const g1 = genOnline(e.gen1);
  const g2 = genOnline(e.gen2);
  if (g1 && g2) return 'Both generators online. Each bus has its own source.';
  if (!g1 && !g2) return 'No generator online. Both buses have no power.';
  const k = g1 ? 1 : 2;
  const j = g1 ? 2 : 1;
  if (e.busTie) return `GEN ${k} powers both buses through the bus tie.${e.backupGenInop ? ' No backup generator remains.' : ''}`;
  return `GEN ${k} powers BUS ${k} only. BUS ${j} has no power.`;
}

export interface ElecMoment {
  label: 'START' | 'AT FAULT' | 'END';
  /** Seconds since the Event Set began. */
  tSec: number;
  elec: Elec;
}

const sameElec = (a: Elec, b: Elec): boolean =>
  a.gen1.switchOn === b.gen1.switchOn &&
  a.gen1.failed === b.gen1.failed &&
  a.gen2.switchOn === b.gen2.switchOn &&
  a.gen2.failed === b.gen2.failed &&
  a.backupGenInop === b.backupGenInop &&
  a.busTie === b.busTie;

/**
 * The electrical states worth drawing in the debrief: the start, the first moment a generator failed, and the end.
 * `null` when the electrical state never changed during the Event Set (nothing to show).
 */
export function elecMoments(history: SetHistory): ElecMoment[] | null {
  const snaps = history.snapshots;
  if (snaps.length === 0) return null;
  const first = snaps[0].ctx.state.elec;
  if (snaps.every((s) => sameElec(s.ctx.state.elec, first))) return null;
  const moment = (label: ElecMoment['label'], s: SetHistory['snapshots'][number], tSec: number): ElecMoment => ({
    label,
    tSec,
    elec: structuredClone(s.ctx.state.elec),
  });
  const out: ElecMoment[] = [moment('START', snaps[0], 0)];
  const fault = snaps.find(
    (s) => (s.ctx.state.elec.gen1.failed && !first.gen1.failed) || (s.ctx.state.elec.gen2.failed && !first.gen2.failed),
  );
  if (fault) out.push(moment('AT FAULT', fault, fault.ctx.tInSet));
  const last = snaps[snaps.length - 1];
  out.push(moment('END', last, last.ctx.tInSet));
  return out;
}
