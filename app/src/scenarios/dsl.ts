// Shared content-only condition and guide helpers.
import type { ControlId } from '../contracts/aircraft';
import type { Condition } from '../contracts/scenario';

type Op = 'eq' | 'neq' | 'gte' | 'lte';
export const st = (path: string, op: Op, value: number | string | boolean): Condition => ({ kind: 'state', path, op, value });
export const all = (...of: Condition[]): Condition => ({ kind: 'all', of });
export const any = (...of: Condition[]): Condition => ({ kind: 'any', of });
export const at = (sec: number): Condition => ({ kind: 'atSec', sec });
export const fired = (ruleId: string, afterSec?: number): Condition =>
  afterSec === undefined ? { kind: 'ruleFired', ruleId } : { kind: 'ruleFired', ruleId, afterSec };
export const replied = (m: { messageId?: string; cardId?: string }): Condition => ({ kind: 'action', match: { kind: 'reply', ...m } });
export const control = (controlId: ControlId, value?: number | boolean | string): Condition => ({
  kind: 'action',
  match: value === undefined ? { kind: 'control', controlId } : { kind: 'control', controlId, value },
});
export const ticked = (checklistId: string, itemId: string): Condition => ({ kind: 'action', match: { kind: 'checklistItem', checklistId, itemId } });
export const allTicked = (checklistId: string, itemIds: string[]): Condition => all(...itemIds.map((i) => ticked(checklistId, i)));

export const litReply = (messageId: string, cardId: string) => ({ kind: 'reply' as const, messageId, cardId });
export const litCard = (cardId: string) => ({ kind: 'reply' as const, cardId });
export const litControl = (controlId: ControlId, value: number | boolean | string) => ({ kind: 'control' as const, controlId, value });
export const between = (path: string, lo: number, hi: number): Condition => all(st(path, 'gte', lo), st(path, 'lte', hi));
