import { readFileSync } from 'node:fs';
import { play } from './guidePlayer';
import { describe, expect, it } from 'vitest';
import type { WorldCue as Cue } from '../../src/contracts/events';
import { parseScenario } from '../../src/contracts/scenario';
import { allScenarios, FLIGHTS } from '../../src/scenarios/registry';
import { SINGLE_SOURCE_VARIATIONS, buildSingleSource } from '../../src/scenarios/single-source';

describe('Single Source variations', () => {
  it('variation 0 serialises byte-for-byte to the pre-refactor baseline', () => {
    const baseline = readFileSync(new URL('../fixtures/single-source-baseline.json', import.meta.url), 'utf8');
    expect(JSON.stringify(buildSingleSource(0))).toBe(baseline);
  });
});

const messages = (s: ReturnType<typeof buildSingleSource>) => [
  ...s.eventSets.flatMap(es => [...es.startCues, ...es.rules.flatMap(r => r.cues)]), s.softTimeout.promptCue,
].filter((c): c is Extract<Cue, { kind: 'message' }> => c.kind === 'message');

it('registers exactly the 2 x 2 x 3 combinations, baseline first', () => {
  expect(SINGLE_SOURCE_VARIATIONS).toHaveLength(12);
  expect(SINGLE_SOURCE_VARIATIONS[0]).toEqual({ failedGen: 1, goodAlternate: 'alt1', numbers: 0 });
  expect(new Set(SINGLE_SOURCE_VARIATIONS.map(v => JSON.stringify(v))).size).toBe(12);
  expect(FLIGHTS[0].variations).toBe(12);
  expect(allScenarios().filter(s => s.id === 'single-source')).toHaveLength(12);
});

it('rejects invalid indices and memoises every valid build', () => {
  for (const i of [-1, 12, 1.5, NaN, Infinity]) expect(() => buildSingleSource(i)).toThrow(RangeError);
  for (let i = 0; i < 12; i++) expect(buildSingleSource(i)).toBe(buildSingleSource(i));
});

it('every message id across all flights maps to exactly one text and channel', () => {
  const seen = new Map<string, string>();
  const baseline = new Map(messages(buildSingleSource(0)).map(c => [c.id, c.text]));
  for (const s of allScenarios()) for (const cue of messages(s)) {
    const content = JSON.stringify([cue.channel, cue.text]);
    if (seen.has(cue.id)) expect(content, cue.id).toBe(seen.get(cue.id));
    seen.set(cue.id, content);
    if (s.id !== 'single-source') continue;
    const baseId = cue.id.split('--')[0];
    if (cue.text === baseline.get(baseId)) expect(cue.id).toBe(baseId);
    else expect(cue.id).toMatch(new RegExp(`^${baseId}--[a-z0-9-]+$`));
    if (cue.audio !== undefined) expect(cue.audio).toBe(`/audio/voice/${cue.id}.mp3`);
  }
});

for (let index = 0; index < 12; index++) {
  it(`variation ${index}: validates, mirrors the failed side, and swaps alternate suitability`, () => {
    const v = SINGLE_SOURCE_VARIATIONS[index];
    const s = buildSingleSource(index);
    expect(() => parseScenario(s)).not.toThrow();
    const es3 = s.eventSets[2];
    const failed = `gen${v.failedGen}`;
    const remaining = `gen${3 - v.failedGen}`;
    const fault = es3.rules.find(r => r.id === 'es3-gen-fail')!;
    expect(fault.when).toEqual({ kind: 'any', of: [{ kind: 'state', path: 'altitudeFt', op: 'gte', value: 10000 }, { kind: 'atSec', sec: 50 }] });
    expect(fault.cues).toContainEqual({ kind: 'aircraft', patch: { elec: { [failed]: { failed: true } } } });
    expect(fault.cues).toContainEqual(expect.objectContaining({ kind: 'alert', text: `GEN ${v.failedGen} FAULT` }));
    expect(s.checklists[1].title).toBe(`GEN ${v.failedGen} FAULT`);
    expect(s.checklists[1].items[1].text).toBe(`GEN ${v.failedGen} switch - OFF`);
    const switchStep = es3.guide!.find(g => g.light.some(t => t.kind === 'control' && t.controlId === `elec.${failed}`))!;
    expect(switchStep.light).toContainEqual({ kind: 'control', controlId: `elec.${failed}`, value: false });
    const bus = es3.rules.find(r => r.id === 'fo-es3-bustie')!;
    expect(JSON.stringify(bus.when)).toContain(`elec.${remaining}.switchOn`);
    if (v.failedGen === 2) {
      const visible = JSON.stringify([s.checklists[1], es3.guide, es3.hints, es3.checks, es3.rules.flatMap(r => r.cues)]);
      expect(visible).not.toMatch(/GEN 1 (?:FAULT|fault|switch - OFF|was not switched off|was switched off and on)/);
    }
    const weak = s.eventSets[3].checks.find(c => c.id === 'es4-weak-alternate')!;
    expect(JSON.stringify(weak)).toContain(`dec-divert-${v.goodAlternate === 'alt1' ? 'alt2' : 'alt1'}`);
    expect(JSON.stringify(weak)).toContain(v.goodAlternate === 'alt1' ? 'Isle Morrow was chosen' : 'Kestry Field was chosen');
    const printout = s.eventSets[3].startCues.find(c => c.kind === 'printout');
    expect(printout?.kind).toBe('printout');
    if (printout?.kind === 'printout') {
      const good = v.goodAlternate === 'alt1' ? 'KESTRY FIELD' : 'ISLE MORROW';
      const bad = v.goodAlternate === 'alt1' ? 'ISLE MORROW' : 'KESTRY FIELD';
      expect(printout.body).toContain(`${good}: 95 nm, over land. Runway 3,200 m, dry.`);
      expect(printout.body).toContain(`${bad}: 240 nm ahead, over water. Runway 1,900 m. Fog forming`);
    }
    const expected = [
      { qnh: 1004, atis: 'Kilo', first: 4000, climb: 12000 },
      { qnh: 1002, atis: 'Lima', first: 5000, climb: 13000 },
      { qnh: 1006, atis: 'Mike', first: 3000, climb: 14000 },
    ][v.numbers];
    const guides = s.eventSets.flatMap(e => e.guide ?? []);
    expect(guides.find(g => g.id === 'g1-baro')!.light[0]).toMatchObject({ value: expected.qnh });
    expect(guides.find(g => g.id === 'g1-alt')!.light[0]).toMatchObject({ value: expected.first });
    expect(guides.find(g => g.id === 'g2-alt')!.light[0]).toMatchObject({ value: expected.climb });
    expect(messages(s).find(c => c.id.startsWith('twr-hold'))!.text).toContain(`Information ${expected.atis}`);
    // All strings stay ASCII; printouts alone may contain line breaks.
    const visit = (x: unknown): void => {
      if (typeof x === 'string') expect(x).toMatch(/^[\x20-\x7E\n]*$/);
      else if (x && typeof x === 'object') Object.values(x).forEach(visit);
    };
    visit(s);
  });
}

// Use the same real session/panel-model player as the baseline guided-flight regression suite.
for (let index = 0; index < 12; index++) {
  for (const direction of ['dev-left', 'dev-right']) {
    it(`variation ${index}: ${direction} then the suitable alternate reaches debrief with four top grades`, () => {
      const v = SINGLE_SOURCE_VARIATIONS[index];
      const result = play({
        decisions: { 'g2-deviate': direction, 'g4-decide': `dec-divert-${v.goodAlternate}` },
        stepClimbControls: true,
        pressIntervalSec: 2,
      }, buildSingleSource(index));
      expect(result.endReason).toBe('diversionSetUp');
      expect(result.reasons).toEqual([[], [], [], []]);
      expect(result.grades).toEqual([4, 4, 4, 4]);
    });
  }
  it(`variation ${index}: the unsuitable alternate is accepted but graded down`, () => {
    const v = SINGLE_SOURCE_VARIATIONS[index];
    const result = play({ decisions: { 'g2-deviate': 'dev-left', 'g4-decide': `dec-divert-${v.goodAlternate === 'alt1' ? 'alt2' : 'alt1'}` } }, buildSingleSource(index));
    expect(result.endReason).toBe('diversionSetUp');
    expect(result.grades.slice(0, 3)).toEqual([4, 4, 4]);
    expect(result.grades[3]).toBeLessThan(4);
    expect(result.reasons[3].join(' ')).toContain('weakest option');
  });
}
