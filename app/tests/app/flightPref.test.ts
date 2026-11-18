// T41: the last variation flown per flight, remembered in the browser. Junk or unavailable storage gives null; nothing throws.
import { describe, expect, it } from 'vitest';
import { lastVariationKey, loadLastVariation, saveLastVariation } from '../../src/app/flightPref';

describe('loadLastVariation', () => {
  it('uses the key trainer.lastVariation.<flightId>', () => {
    expect(lastVariationKey('single-source')).toBe('trainer.lastVariation.single-source');
  });

  it('reads a stored whole number for that flight only', () => {
    const store = { getItem: (k: string) => (k === 'trainer.lastVariation.single-source' ? '7' : '3') };
    expect(loadLastVariation('single-source', store)).toBe(7);
    expect(loadLastVariation('time-critical', store)).toBe(3);
    expect(loadLastVariation('single-source', { getItem: () => '0' })).toBe(0);
  });

  it('gives null for a missing or junk value', () => {
    for (const v of [null, '', ' ', 'abc', '-1', '1.5', 'NaN', 'Infinity', '3abc', '1e3', '0x10']) {
      expect(loadLastVariation('single-source', { getItem: () => v }), `stored ${JSON.stringify(v)}`).toBeNull();
    }
  });

  it('gives null when reading throws', () => {
    expect(loadLastVariation('single-source', { getItem: () => { throw new Error('SecurityError'); } })).toBeNull();
  });

  it('does not throw when there is no localStorage at all (node)', () => {
    expect(loadLastVariation('single-source')).toBeNull();
  });
});

describe('saveLastVariation', () => {
  it('writes the number as text under the flight key', () => {
    const calls: Array<[string, string]> = [];
    saveLastVariation('single-source', 5, { setItem: (k, v) => void calls.push([k, v]) });
    expect(calls).toEqual([['trainer.lastVariation.single-source', '5']]);
  });

  it('swallows a throwing storage and does not throw without one', () => {
    expect(() => saveLastVariation('single-source', 5, { setItem: () => { throw new Error('QuotaExceededError'); } })).not.toThrow();
    expect(() => saveLastVariation('single-source', 5)).not.toThrow();
  });

  it('ignores a value that is not a whole number', () => {
    const calls: unknown[] = [];
    for (const v of [-1, 1.5, NaN, Infinity]) saveLastVariation('single-source', v, { setItem: (...a) => void calls.push(a) });
    expect(calls).toEqual([]);
  });
});
