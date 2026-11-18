import { describe, expect, it } from 'vitest';
import { currentGuide, guideWorldFromModels } from '../../src/app/guide';
import { parseScenario, type GuideStep } from '../../src/contracts/scenario';
import { evaluate } from '../../src/engine/conditions';
import { gradeEventSet } from '../../src/engine/grading';
import { ScenarioEngine } from '../../src/engine/scenarioEngine';
import { buildTimeline } from '../../src/engine/timeline';
import { ChecklistModel, CommsModel } from '../../src/xr/panels/panelModel';
import { padNamesForAll } from '../../src/xr/guide/resolve';
import { miniScenario } from '../fixtures/mini-scenario';

const defs = [
  { id: 'list', title: 'List', items: ['a', 'b', 'c'].map((id) => ({ id, text: id })) },
  { id: 'other', title: 'Other', items: [{ id: 'a', text: 'Other a' }] },
];
const model = () => {
  const m = new ChecklistModel(defs);
  m.open('list');
  return m;
};

describe('checklist untick', () => {
  it('removes a tick without an action; a re-tick emits a fresh normal action', () => {
    const m = model();
    const first = m.tick('a');
    expect(m.untick('a')).toBe(true);
    expect(m.isTicked('a')).toBe(false);
    expect(m.tickOrder()).toEqual([]);
    expect(m.tick('a')).toEqual(first);
    expect(m.isTicked('a')).toBe(true);
    expect(m.tickOrder()).toEqual(['a']);
  });

  it('removes the out-of-order record and recomputes the re-tick using current ticks', () => {
    const m = model();
    expect(m.tick('c')?.inOrder).toBe(false);
    m.tick('a');
    m.tick('b');
    expect(m.untick('c')).toBe(true);
    expect(m.outOfOrder()).toEqual([]);
    expect(m.tickOrder()).toEqual(['a', 'b']);
    expect(m.tick('c')?.inOrder).toBe(true);
    expect(m.outOfOrder()).toEqual([]);
    m.untick('a');
    m.untick('c');
    expect(m.tick('c')?.inOrder).toBe(false);
    expect(m.outOfOrder()).toEqual(['c']);
    expect(m.tickOrder()).toEqual(['b', 'c']);
  });

  it('ignores unticks when not live, unknown, already empty or no checklist is open', () => {
    const m = model();
    expect(m.untick('unknown')).toBe(false);
    expect(m.untick('a')).toBe(false);
    m.tick('a');
    m.live = false;
    expect(m.untick('a')).toBe(false);
    expect(m.isTicked('a')).toBe(true);
    m.live = true;
    m.reset();
    expect(m.untick('a')).toBe(false);
  });

  it('keeps an untick local to the open checklist', () => {
    const m = model();
    m.tick('a');
    m.open('other');
    m.tick('a');
    m.untick('a');
    expect(m.isTicked('a')).toBe(false);
    m.open('list');
    expect(m.isTicked('a')).toBe(true);
  });

  for (const reset of ['reset', 'flight swap'] as const) {
    it(`${reset} clears ticks and order records, including re-ticks, from every checklist`, () => {
      const m = model();
      m.tick('c');
      m.untick('c');
      m.tick('c');
      m.open('other');
      m.tick('a');
      if (reset === 'reset') m.reset();
      else {
        m.setDefs([{ id: 'new', title: 'New', items: [{ id: 'n', text: 'New item' }] }]);
        expect(m.open('list')).toBe(false);
        m.setDefs(defs);
      }
      expect(m.current()).toBeNull();
      for (const id of ['list', 'other']) {
        m.open(id);
        expect(m.tickOrder()).toEqual([]);
        expect(m.outOfOrder()).toEqual([]);
        expect(m.isTicked('a')).toBe(false);
        expect(m.isTicked('c')).toBe(false);
      }
    });
  }
});

function run() {
  const raw = structuredClone(miniScenario);
  raw.eventSets[0].startCues.push({ kind: 'checklistAvailable', checklistId: 'cl-a' } as never);
  const match = { kind: 'checklistItem' as const, checklistId: 'cl-a', itemId: 'a1' };
  raw.eventSets[0].checks = [{ kind: 'required', id: 'item', when: { kind: 'action', match }, withinSec: 1, category: 'procedures', reason: 'Item missing.' } as never];
  const scenario = parseScenario(raw);
  const engine = new ScenarioEngine(scenario, { mode: 'auto' });
  engine.start();
  const checklist = new ChecklistModel(scenario.checklists);
  checklist.open('cl-a');
  const guide: GuideStep[] = [
    { id: 'item', where: 'List', text: 'First item', light: [match], doneWhen: { kind: 'action', match } },
    { id: 'later', where: 'List', text: 'Second item', light: [{ ...match, itemId: 'a2' }], doneWhen: { kind: 'action', match: { ...match, itemId: 'a2' } } },
  ];
  const world = guideWorldFromModels(new CommsModel(), checklist, () => []);
  const history = () => engine.historyFor('es-a');
  const ctx = () => {
    const snapshots = history().snapshots;
    return snapshots[snapshots.length - 1].ctx;
  };
  const current = () => currentGuide(guide, ctx(), world);
  const grade = () => gradeEventSet(scenario.eventSets[0], history(), scenario.latenessGraceSec);
  return { scenario, engine, checklist, guide, world, history, ctx, current, grade, match };
}

describe('untick consumers', () => {
  it('keeps completed conditions and the next guide frame after an untick, including at a later step', () => {
    const r = run();
    expect(r.current()?.stepId).toBe('item');
    r.engine.dispatch(r.checklist.tick('a1')!.action);
    expect(r.current()?.stepId).toBe('later');
    r.checklist.untick('a1');
    expect(r.world.checklistItemOpen('cl-a', 'a1')).toBe(true);
    expect(evaluate(r.guide[0].doneWhen, r.ctx())).toBe(true);
    expect(r.current()).toMatchObject({ stepId: 'later', waiting: false, targets: [{ ...r.match, itemId: 'a2' }] });
    const panels = { comms: {} as never, checklist: { rowOf: (id: string) => ({ page: 0, slot: id === 'a1' ? 0 : 1 }), pageIndex: () => 0 } };
    expect(padNamesForAll(r.current()!.targets, r.engine.state, panels)).toEqual(['pad:check.row.1']);
    r.engine.dispatch(r.checklist.tick('a1')!.action);
    r.engine.dispatch(r.checklist.tick('a2')!.action);
    expect(r.current()).toBeNull();
    r.checklist.untick('a1');
    expect(r.current()).toBeNull();
  });

  it('records re-ticks as actions but keeps first satisfaction, grade and a single timeline row', () => {
    const r = run();
    r.engine.dispatch(r.checklist.tick('a1')!.action);
    const firstGrade = r.grade();
    expect(firstGrade.grade).toBe(4);
    const timeline = () => buildTimeline(r.scenario, r.scenario.eventSets[0], r.history());
    const firstTimeline = timeline();
    r.checklist.untick('a1');
    expect(r.engine.actionsFor('es-a')).toHaveLength(1);
    expect(r.grade()).toEqual(firstGrade);
    r.engine.tick(5);
    r.engine.dispatch({ kind: 'hint', eventSetId: 'es-a' });
    const beforeRetick = r.grade();
    r.engine.dispatch(r.checklist.tick('a1')!.action);
    expect(r.engine.actionsFor('es-a').filter((a) => a.body.kind === 'checklistItem')).toHaveLength(2);
    expect(r.grade()).toEqual(beforeRetick); // late re-tick after hint cannot replace first satisfaction
    expect(r.grade().grade).toBe(firstGrade.grade);
    expect(timeline().filter((e) => e.text.startsWith('CHECKED:'))).toEqual(firstTimeline.filter((e) => e.text.startsWith('CHECKED:')));
  });

  it('deduplicates by checklist AND item, without suppressing a different checklist or item', () => {
    const r = run();
    r.engine.dispatch(r.match);
    r.engine.dispatch({ ...r.match, itemId: 'a2' });
    r.engine.dispatch({ ...r.match, checklistId: 'other' });
    r.engine.dispatch(r.match);
    const entries = buildTimeline(r.scenario, r.scenario.eventSets[0], r.history());
    expect(entries.filter((e) => e.text.startsWith('CHECKED:')).map((e) => e.text)).toEqual(['CHECKED: Item one', 'CHECKED: Item two', 'CHECKED: a1']);
    // Rebuilding the same review and starting another run must each keep its first confirmation.
    expect(buildTimeline(r.scenario, r.scenario.eventSets[0], r.history())).toEqual(entries);
    const fresh = run();
    fresh.engine.dispatch(fresh.match);
    expect(buildTimeline(fresh.scenario, fresh.scenario.eventSets[0], fresh.history()).some((e) => e.text === 'CHECKED: Item one')).toBe(true);
  });
});
