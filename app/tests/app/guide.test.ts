import { describe, expect, it } from 'vitest';
import type { CondCtx } from '../../src/engine/conditions';
import type { Condition, GuideStep } from '../../src/contracts/scenario';
import type { WorldCue } from '../../src/contracts/events';
import { GUIDE_WAIT_TEXT, currentGuide, guideWorldFromModels, targetExists, type GuideWorld } from '../../src/app/guide';
import { ChecklistModel, CommsModel } from '../../src/xr/panels/panelModel';

const ctxAt = (t: number): CondCtx => ({ tInSet: t, now: t, state: {} as CondCtx['state'], actions: [], fired: new Map() });
const at = (sec: number): Condition => ({ kind: 'atSec', sec });
const ctrl = { kind: 'control' as const, controlId: 'gen2' as never };
const step = (id: string, doneAt: number, over: Partial<GuideStep> = {}): GuideStep => ({
  id,
  where: `where ${id}`,
  text: `text ${id}`,
  light: [ctrl],
  doneWhen: at(doneAt),
  ...over,
});
const world = (over: Partial<GuideWorld> = {}): GuideWorld => ({ cardPending: () => false, checklistItemOpen: () => false, alertUnacked: () => false, ...over });

describe('currentGuide', () => {
  it('returns the first unfinished step with index 1 of 3', () => {
    const v = currentGuide([step('a', 10), step('b', 20), step('c', 30)], ctxAt(0), world());
    expect(v).toMatchObject({ stepId: 'a', index: 1, count: 3, where: 'where a', text: 'text a', waiting: false });
    expect(v?.targets).toEqual([ctrl]);
  });

  it('skips a step that was done early', () => {
    const g = [step('a', 100), step('b', 0), step('c', 200)];
    expect(currentGuide(g, ctxAt(50), world())).toMatchObject({ stepId: 'a', index: 2, count: 3 });
    expect(currentGuide(g, ctxAt(100), world())).toMatchObject({ stepId: 'c', index: 3, count: 3 });
  });

  it('a step with onlyWhen false is not counted and never shown; once true it is', () => {
    const g = [step('a', 10), step('b', 20, { onlyWhen: at(5) }), step('c', 30)];
    expect(currentGuide(g, ctxAt(0), world())).toMatchObject({ stepId: 'a', count: 2 });
    expect(currentGuide(g, ctxAt(5), world())).toMatchObject({ stepId: 'a', count: 3 });
    expect(currentGuide(g, ctxAt(10), world())).toMatchObject({ stepId: 'b', index: 2, count: 3 });
  });

  it("waiting: no target exists -> targets [], waiting true, text is waitText, or 'Stand by.' when the step has none", () => {
    const reply = { kind: 'reply' as const, messageId: 'm1', cardId: 'c1' };
    const w = currentGuide([step('a', 10, { light: [reply], waitText: 'Wait for the call.' })], ctxAt(0), world());
    expect(w).toMatchObject({ waiting: true, targets: [], text: 'Wait for the call.' });
    const d = currentGuide([step('a', 10, { light: [reply] })], ctxAt(0), world());
    expect(d).toMatchObject({ waiting: true, targets: [], text: GUIDE_WAIT_TEXT });
    expect(GUIDE_WAIT_TEXT).toBe('Stand by.');
  });

  it('a decision step returns only the cards that are pending', () => {
    const light = [1, 2, 3].map((n) => ({ kind: 'reply' as const, messageId: 'm', cardId: `c${n}` }));
    const w = world({ cardPending: (_m, c) => c !== 'c3' });
    const v = currentGuide([step('a', 10, { light })], ctxAt(0), w);
    expect(v?.targets.length).toBe(2);
    expect(v?.waiting).toBe(false);
    expect(v?.text).toBe('text a');
  });

  it('returns null when every applicable step is done and when guide is undefined', () => {
    expect(currentGuide([step('a', 1), step('b', 2, { onlyWhen: at(99) })], ctxAt(5), world())).toBeNull();
    expect(currentGuide(undefined, ctxAt(5), world())).toBeNull();
  });
});

describe('targetExists', () => {
  it('maps each kind to the world', () => {
    const w = world({ cardPending: () => true, checklistItemOpen: () => true, alertUnacked: () => true });
    expect(targetExists(ctrl, world())).toBe(true);
    expect(targetExists({ kind: 'reply' }, w)).toBe(true);
    expect(targetExists({ kind: 'checklistItem', checklistId: 'k', itemId: 'i' }, w)).toBe(true);
    expect(targetExists({ kind: 'alertAck', alertId: 'a' }, w)).toBe(true);
    expect(targetExists({ kind: 'hint' }, w)).toBe(false);
  });
});

describe('guideWorldFromModels', () => {
  const msg: WorldCue = { kind: 'message', id: 'm1', channel: 'atc', text: 'Call', cards: [{ id: 'c1', text: 'One' }, { id: 'c2', text: 'Two' }] };
  const alert = (acked: boolean) => [{ id: 'al', level: 'caution' as never, text: 'x', acked }];

  it('a card is pending after its message cue and not after choose', () => {
    const comms = new CommsModel();
    const checklist = new ChecklistModel([]);
    const w = guideWorldFromModels(comms, checklist, () => []);
    expect(w.cardPending('m1', 'c1')).toBe(false);
    comms.apply(msg);
    expect(w.cardPending('m1', 'c1')).toBe(true);
    expect(w.cardPending(undefined, 'c2')).toBe(true);
    expect(w.cardPending('m1', undefined)).toBe(true);
    expect(w.cardPending('other', 'c1')).toBe(false);
    comms.choose('m1', 'c1');
    expect(w.cardPending('m1', 'c1')).toBe(false);
  });

  it('an item is open after open(id) and not after tick', () => {
    const checklist = new ChecklistModel([{ id: 'ck', title: 'List', items: [{ id: 'i1', text: 'One' }] }]);
    const w = guideWorldFromModels(new CommsModel(), checklist, () => []);
    expect(w.checklistItemOpen('ck', 'i1')).toBe(false);
    checklist.open('ck');
    expect(w.checklistItemOpen('ck', 'i1')).toBe(true);
    expect(w.checklistItemOpen('zz', 'i1')).toBe(false);
    checklist.tick('i1');
    expect(w.checklistItemOpen('ck', 'i1')).toBe(false);
  });

  it('an alert is unacked while listed with acked false', () => {
    let list = alert(false);
    const w = guideWorldFromModels(new CommsModel(), new ChecklistModel([]), () => list);
    expect(w.alertUnacked('al')).toBe(true);
    expect(w.alertUnacked('nope')).toBe(false);
    list = alert(true);
    expect(w.alertUnacked('al')).toBe(false);
  });
});
