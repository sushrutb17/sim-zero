// Pure guide tracker for guided flight: picks the step to show. No rendering or IWSDK imports.
import type { ActionMatch, GuideStep } from '../contracts/scenario';
import { evaluate, type CondCtx } from '../engine/conditions';
import type { ChecklistModel, CommsModel } from '../xr/panels/panelModel';
import type { ActiveAlert } from '../xr/displays/alerts';

export interface GuideWorld {
  cardPending(messageId: string | undefined, cardId: string | undefined): boolean;
  checklistItemOpen(checklistId: string, itemId: string): boolean;
  alertUnacked(alertId: string): boolean;
}

export interface GuideView {
  stepId: string;
  index: number; // 1 + number of applicable steps already done
  count: number; // number of applicable steps
  where: string;
  text: string; // step.text, or the wait text while waiting
  waiting: boolean; // true when none of the step's targets exists yet
  targets: ActionMatch[]; // the step's light entries that exist now
}

export const GUIDE_WAIT_TEXT = 'Stand by.';
export const GUIDE_IDLE_TEXT = 'Good. Stand by for the next event.';

/** Whether the thing a light entry points at is on screen right now. */
export function targetExists(m: ActionMatch, world: GuideWorld): boolean {
  switch (m.kind) {
    case 'control':
      return true;
    case 'reply':
      return world.cardPending(m.messageId, m.cardId);
    case 'checklistItem':
      return m.checklistId !== undefined && m.itemId !== undefined ? world.checklistItemOpen(m.checklistId, m.itemId) : false;
    case 'alertAck':
      return m.alertId !== undefined ? world.alertUnacked(m.alertId) : false;
    case 'hint':
      return false;
  }
}

export function currentGuide(guide: readonly GuideStep[] | undefined, ctx: CondCtx, world: GuideWorld): GuideView | null {
  if (!guide) return null;
  const applicable = guide.filter((s) => !s.onlyWhen || evaluate(s.onlyWhen, ctx));
  let done = 0;
  let current: GuideStep | undefined;
  for (const s of applicable) {
    if (evaluate(s.doneWhen, ctx)) done++;
    else current ??= s;
  }
  if (!current) return null;
  const targets = current.light.filter((m) => targetExists(m, world));
  const waiting = targets.length === 0;
  return {
    stepId: current.id,
    index: done + 1,
    count: applicable.length,
    where: current.where,
    text: waiting ? (current.waitText ?? GUIDE_WAIT_TEXT) : current.text,
    waiting,
    targets,
  };
}

export function guideWorldFromModels(comms: CommsModel, checklist: ChecklistModel, alerts: () => readonly ActiveAlert[]): GuideWorld {
  return {
    cardPending: (messageId, cardId) =>
      comms.pendingCards().some((c) => (messageId === undefined || c.messageId === messageId) && (cardId === undefined || c.cardId === cardId)),
    checklistItemOpen: (checklistId, itemId) => checklist.current()?.id === checklistId && !checklist.isTicked(itemId),
    alertUnacked: (alertId) => alerts().some((a) => a.id === alertId && !a.acked),
  };
}
