// Pure condition evaluation. No rendering imports: runs headless in Node.
import type { AircraftState } from '../contracts/aircraft';
import type { PilotAction, Stamped } from '../contracts/events';
import type { ActionMatch, Condition } from '../contracts/scenario';
import { readPath } from './aircraft';

const EPS = 1e-9;

export interface CondCtx {
  tInSet: number;
  state: AircraftState;
  actions: Stamped<PilotAction>[];
  fired: ReadonlyMap<string, number>;
  /** Absolute scenario time of this context; `ruleFired.afterSec` compares against it. */
  now: number;
}

export interface SetHistory {
  snapshots: { t: number; ctx: CondCtx }[];
  hintTimes: number[];
}

/** True when every key given in `match` equals the same key on the action body (`kind` included). */
export function matchesAction(match: ActionMatch, body: PilotAction): boolean {
  const b = body as unknown as Record<string, unknown>;
  return Object.entries(match).every(([k, v]) => v === undefined || b[k] === v);
}

export function evaluate(c: Condition, ctx: CondCtx): boolean {
  switch (c.kind) {
    case 'atSec':
      return ctx.tInSet >= c.sec - EPS;
    case 'ruleFired': {
      const t = ctx.fired.get(c.ruleId);
      if (t === undefined) return false;
      return c.afterSec === undefined || ctx.now - t >= c.afterSec - EPS;
    }
    case 'state': {
      const v = readPath(ctx.state, c.path);
      switch (c.op) {
        case 'eq': return v === c.value;
        case 'neq': return v !== c.value;
        case 'gte': return typeof v === 'number' && typeof c.value === 'number' && v >= c.value;
        case 'lte': return typeof v === 'number' && typeof c.value === 'number' && v <= c.value;
      }
      return false;
    }
    case 'action':
      return ctx.actions.some((a) => matchesAction(c.match, a.body));
    case 'all':
      return c.of.every((x) => evaluate(x, ctx));
    case 'any':
      return c.of.some((x) => evaluate(x, ctx));
  }
}
