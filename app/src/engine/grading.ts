// Deterministic Event Set grading. Pure: runs headless in Node.
import type { EventSetGrade, ReasonCategory } from '../contracts/events';
import type { CheckDef, EventSetDef } from '../contracts/scenario';
import { evaluate, type SetHistory } from './conditions';

type Kind = 'safety' | 'missed' | 'untrappedMajor' | 'prompted' | 'untrappedMinor' | 'trappedMajor' | 'late' | 'trappedMinor' | 'poorComm';
/** Reason order, most severe first. */
const ORDER: Kind[] = ['safety', 'missed', 'untrappedMajor', 'prompted', 'untrappedMinor', 'trappedMajor', 'late', 'trappedMinor', 'poorComm'];

type Finding = { kind: Kind; category: ReasonCategory; text: string; index: number };

export function gradeEventSet(def: EventSetDef, history: SetHistory, graceSec: number): EventSetGrade {
  const { snapshots, hintTimes } = history;
  const last = snapshots[snapshots.length - 1];
  const found: Finding[] = [];
  const add = (kind: Kind, c: CheckDef) => found.push({ kind, category: c.category, text: c.reason, index: found.length });

  const isSent = (messageId: string): boolean => {
    if (def.startCues.some((c) => c.kind === 'message' && c.id === messageId)) return true;
    if (!last) return false;
    const ruleSent = def.rules.some((r) => last.ctx.fired.has(r.id) && r.cues.some((c) => c.kind === 'message' && c.id === messageId));
    return ruleSent || last.ctx.actions.some((a) => a.body.kind === 'reply' && a.body.messageId === messageId);
  };

  // A hint prompted a satisfaction if it is among the actions recorded in that snapshot (exact order),
  // or (for histories without recorded hint actions) its time is strictly earlier. A hint in the same
  // instant but after the satisfying snapshot must not count.
  const promptedBy = (s: { t: number; ctx: { actions: { body: { kind: string } }[] } }): boolean =>
    s.ctx.actions.some((a) => a.body.kind === 'hint') || hintTimes.some((h) => h < s.t);

  for (const c of def.checks) {
    switch (c.kind) {
      case 'required': {
        const s = snapshots.find((x) => evaluate(c.when, x.ctx));
        if (!s) add('missed', c);
        else if (promptedBy(s)) add('prompted', c);
        else if (c.withinSec !== undefined && s.ctx.tInSet > c.withinSec + graceSec) add('late', c);
        break;
      }
      case 'errorTrap': {
        // Snapshot ORDER, not time: a dispatch shares clock.now with an earlier periodic snapshot, so
        // comparing times would let a pre-error snapshot count as the correction. The occurrence
        // snapshot itself is included: it is taken after the erroneous action/state was applied.
        const occIdx = snapshots.findIndex((x) => evaluate(c.when, x.ctx));
        if (occIdx < 0) break;
        const occ = snapshots[occIdx];
        const trapped =
          c.trappedWhen !== undefined &&
          snapshots
            .slice(occIdx)
            .some((x) => (c.trapWithinSec === undefined || x.t - occ.t <= c.trapWithinSec) && evaluate(c.trappedWhen!, x.ctx));
        add(trapped ? (c.severity === 'major' ? 'trappedMajor' : 'trappedMinor') : c.severity === 'major' ? 'untrappedMajor' : 'untrappedMinor', c);
        break;
      }
      case 'comm': {
        if (!isSent(c.messageId)) break; // never sent: nothing to grade
        const first = (last?.ctx.actions ?? [])
          .filter((a) => a.body.kind === 'reply' && a.body.messageId === c.messageId)
          .sort((a, b) => a.seq - b.seq)[0];
        const q = first && first.body.kind === 'reply' ? c.quality[first.body.cardId] : undefined;
        if (q === undefined || q === 'poor') add('poorComm', c);
        break;
      }
      case 'safety':
        if (snapshots.some((x) => evaluate(c.when, x.ctx))) add('safety', c);
        break;
    }
  }

  const has = (...ks: Kind[]) => found.some((f) => ks.includes(f.kind));
  let grade: 1 | 2 | 3 | 4 = 4;
  if (has('late', 'trappedMinor', 'poorComm')) grade = 3;
  if (has('prompted', 'trappedMajor', 'untrappedMinor')) grade = 2;
  if (has('safety', 'missed', 'untrappedMajor')) grade = 1;

  const reasons: EventSetGrade['reasons'] = [];
  const seen = new Set<string>();
  for (const f of [...found].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.index - b.index)) {
    if (seen.has(f.text)) continue;
    seen.add(f.text);
    reasons.push({ category: f.category, text: f.text });
    if (reasons.length === 3) break;
  }

  return { eventSetId: def.id, grade, reasons, hintUsed: hintTimes.length > 0, source: 'auto' };
}
