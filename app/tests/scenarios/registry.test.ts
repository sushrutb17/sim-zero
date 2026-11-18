// Flight registry (plan 2026-11-15).
import { describe, expect, it } from 'vitest';
import { FLIGHTS, allScenarios, flightById, pickVariation } from '../../src/scenarios/registry';
import { singleSource } from '../../src/scenarios/single-source';

describe('flight registry', () => {
  it('lists Single Source first, with ASCII card text and a baseline that is the current scenario', () => {
    expect(FLIGHTS[0].id).toBe('single-source');
    expect(flightById('single-source')?.build(0)).toBe(singleSource);
    expect(flightById('nope')).toBeUndefined();
    for (const f of FLIGHTS) {
      expect(`${f.title}${f.blurb}`).toMatch(/^[\x20-\x7E]+$/);
      expect(f.variations).toBeGreaterThanOrEqual(1);
      expect(new Set(FLIGHTS.map((x) => x.id)).size).toBe(FLIGHTS.length);
    }
    expect(allScenarios()[0]).toBe(singleSource);
    expect(allScenarios()).toHaveLength(FLIGHTS.reduce((n, f) => n + f.variations, 0));
  });

  it('never reuses a reply card id with different text across flights', () => {
    const cards = new Map<string, { flight: string; text: string }[]>();
    for (const flight of FLIGHTS) for (let v = 0; v < flight.variations; v++) {
      const sc = flight.build(v);
      const cues = [sc.softTimeout.promptCue, ...sc.eventSets.flatMap(es => [...es.startCues, ...es.rules.flatMap(r => r.cues)])];
      for (const cue of cues) if (cue.kind === 'message') for (const card of cue.cards ?? []) {
        for (const other of cards.get(card.id) ?? []) if (other.flight !== flight.id) {
          expect(card.text, `${card.id}: ${other.flight} / ${flight.id}`).toBe(other.text);
        }
        cards.set(card.id, [...(cards.get(card.id) ?? []), { flight: flight.id, text: card.text }]);
      }
    }
  });
});

describe('pickVariation', () => {
  it('stays in range and never repeats the last one', () => {
    for (let last = 0; last < 12; last++)
      for (let k = 0; k <= 100; k++) {
        const v = pickVariation(12, last, () => k / 100);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(12);
        expect(v).not.toBe(last);
      }
  });

  it('can reach every other variation, and every variation when there is no last one', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) seen.add(pickVariation(12, 3, () => k / 1000));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
    const all = new Set<number>();
    for (let k = 0; k < 1000; k++) all.add(pickVariation(12, null, () => k / 1000));
    expect(all.size).toBe(12);
  });

  it('copes with one variation, a junk last value and a generator that returns 1', () => {
    expect(pickVariation(1, 0, () => 0.9)).toBe(0);
    expect(pickVariation(0, null, () => 0.9)).toBe(0);
    expect(pickVariation(4, 99, () => 0.99)).toBe(3);
    expect(pickVariation(4, -1, () => 1)).toBe(3);
    expect(pickVariation(4, 3, () => 1)).toBe(2);
  });
});
