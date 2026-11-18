/** Debrief rows (spec section 4.5) built ONLY from TrainingSession.results(): original grades, plus the redo grade next to its set. */
import { REASON_LABELS, type EventSetGrade } from '../contracts/events';
import type { Scenario } from '../contracts/scenario';
import type { SessionResults } from '../engine/session';

export interface DebriefReason {
  label: string;
  text: string;
}

export interface DebriefRow {
  eventSetId: string;
  title: string;
  technical: string;
  crm: string;
  grade: 1 | 2 | 3 | 4;
  hintUsed: boolean;
  reasons: DebriefReason[];
  /** Instructor comment when an instructor overrode the grade (Task 15). */
  comment?: string;
  redoGrade?: 1 | 2 | 3 | 4;
  redoHintUsed?: boolean;
  redoReasons?: DebriefReason[];
}

const reasonsOf = (g: EventSetGrade): DebriefReason[] => g.reasons.slice(0, 3).map((r) => ({ label: REASON_LABELS[r.category], text: r.text }));

export function debriefRows(scenario: Pick<Scenario, 'eventSets'>, results: SessionResults): DebriefRow[] {
  return results.original.map((g) => {
    const es = scenario.eventSets.find((s) => s.id === g.eventSetId);
    const row: DebriefRow = {
      eventSetId: g.eventSetId,
      title: es?.title ?? g.eventSetId,
      technical: es?.technical ?? '',
      crm: es?.crm ?? '',
      grade: g.grade,
      hintUsed: g.hintUsed,
      reasons: reasonsOf(g),
      ...(g.comment ? { comment: g.comment } : {}),
    };
    const redo = results.redo;
    if (redo && redo.eventSetId === g.eventSetId) {
      row.redoGrade = redo.grade.grade;
      row.redoHintUsed = redo.grade.hintUsed;
      row.redoReasons = reasonsOf(redo.grade);
    }
    return row;
  });
}
