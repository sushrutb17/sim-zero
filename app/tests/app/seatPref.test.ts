// T40: the remembered seat offset. Junk, out-of-range or unavailable storage falls back to the 0.30 m default (T51; 0.15 in T47, 0.10 in T40); nothing throws.
import { describe, expect, it } from 'vitest';
import { SEAT_KEY, loadSeatOffset, saveSeatOffset } from '../../src/app/seatPref';
import { SEAT_DEFAULT_M } from '../../src/xr/seatMath';

const store = (value: string | null) => ({ getItem: (k: string) => (k === SEAT_KEY ? value : 'wrong key') });

describe('loadSeatOffset', () => {
  it('uses the key trainer.seatOffsetM', () => {
    expect(SEAT_KEY).toBe('trainer.seatOffsetM');
  });

  it('gives the default for a missing, junk or out-of-range value', () => {
    for (const v of [null, '', 'abc', '9', '-1', 'NaN', 'Infinity', '0.51', '-0.01', '0.1abc']) {
      expect(loadSeatOffset(store(v)), `stored ${JSON.stringify(v)}`).toBe(SEAT_DEFAULT_M);
    }
  });

  it('gives the default when reading throws', () => {
    expect(loadSeatOffset({ getItem: () => { throw new Error('SecurityError'); } })).toBe(SEAT_DEFAULT_M);
  });

  it('reads every value on the grid, and snaps a value between steps', () => {
    for (const v of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]) expect(loadSeatOffset(store(String(v)))).toBe(v);
    expect(loadSeatOffset(store('0'))).toBe(0);
    expect(loadSeatOffset(store('0.12'))).toBe(0.1);
  });

  it('does not throw when there is no localStorage at all (node)', () => {
    expect(loadSeatOffset()).toBe(SEAT_DEFAULT_M);
  });
});

describe('saveSeatOffset', () => {
  it('writes the number as text under the key', () => {
    const calls: Array<[string, string]> = [];
    saveSeatOffset(0.15, { setItem: (k, v) => void calls.push([k, v]) });
    expect(calls).toEqual([[SEAT_KEY, '0.15']]);
  });

  it('swallows a throwing storage (quota, private mode)', () => {
    expect(() => saveSeatOffset(0.1, { setItem: () => { throw new Error('QuotaExceededError'); } })).not.toThrow();
    expect(() => saveSeatOffset(0.1)).not.toThrow();
  });
});
