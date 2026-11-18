import { describe, expect, it } from 'vitest';
import { loadInOrder } from '../../src/xr/voiceLoader';

/** A loader whose promises the test settles by hand; records the order of starts and the peak number in flight. */
function harness() {
  const started: string[] = [];
  const pending = new Map<string, { resolve(): void; reject(e: Error): void }>();
  let inFlight = 0;
  let peak = 0;
  const loadOne = (id: string) => new Promise<void>((resolve, reject) => {
    started.push(id); inFlight++; peak = Math.max(peak, inFlight);
    pending.set(id, { resolve: () => { inFlight--; resolve(); }, reject: (e) => { inFlight--; reject(e); } });
  });
  return { started, pending, loadOne, peak: () => peak, inFlight: () => inFlight };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('loadInOrder', () => {
  it('starts loads in the given order and never more than `concurrency` at once', async () => {
    const h = harness();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const done = loadInOrder(ids, h.loadOne, 3);
    await tick();
    expect(h.started).toEqual(['a', 'b', 'c']);
    h.pending.get('b')!.resolve(); await tick();
    expect(h.started).toEqual(['a', 'b', 'c', 'd']);
    h.pending.get('a')!.resolve(); h.pending.get('c')!.resolve(); await tick();
    expect(h.started).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    for (const id of ['d', 'e', 'f']) h.pending.get(id)!.resolve();
    await tick();
    h.pending.get('g')!.resolve();
    expect(await done).toEqual({ loaded: 7, failed: [] });
    expect(h.started).toEqual(ids);
    expect(h.peak()).toBe(3);
  });

  it('reports a rejection in failed and still loads the rest', async () => {
    const h = harness();
    const done = loadInOrder(['a', 'b', 'c', 'd'], h.loadOne, 2);
    await tick();
    h.pending.get('a')!.reject(new Error('404'));
    await tick();
    h.pending.get('b')!.resolve(); h.pending.get('c')!.resolve(); await tick();
    h.pending.get('d')!.resolve();
    expect(await done).toEqual({ loaded: 3, failed: ['a'] });
    expect(h.started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('records a loader that throws synchronously as failed', async () => {
    const seen: string[] = [];
    const result = await loadInOrder(['a', 'b'], (id) => { seen.push(id); if (id === 'a') throw new Error('unknown'); return Promise.resolve(); }, 2);
    expect(result).toEqual({ loaded: 1, failed: ['a'] });
    expect(seen).toEqual(['a', 'b']);
  });

  it('requests each id once even when the list repeats it', async () => {
    const calls: string[] = [];
    const result = await loadInOrder(['a', 'b', 'a', 'c', 'b', 'a'], async (id) => { calls.push(id); }, 4);
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ loaded: 3, failed: [] });
  });

  it('resolves at once for an empty list without calling the loader', async () => {
    let calls = 0;
    expect(await loadInOrder([], async () => { calls++; })).toEqual({ loaded: 0, failed: [] });
    expect(calls).toBe(0);
  });

  it('defaults to four at a time', async () => {
    const h = harness();
    const done = loadInOrder(['a', 'b', 'c', 'd', 'e', 'f'], h.loadOne);
    await tick();
    expect(h.started).toHaveLength(4);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) { await tick(); h.pending.get(id)?.resolve(); }
    await done;
    expect(h.peak()).toBe(4);
  });

  it.each([0, -3, NaN, Infinity, -Infinity])('treats concurrency %s as 1', async (concurrency) => {
    const h = harness();
    const done = loadInOrder(['a', 'b', 'c'], h.loadOne, concurrency);
    for (const id of ['a', 'b', 'c']) { await tick(); expect(h.inFlight()).toBe(1); h.pending.get(id)!.resolve(); }
    expect(await done).toEqual({ loaded: 3, failed: [] });
    expect(h.started).toEqual(['a', 'b', 'c']);
    expect(h.peak()).toBe(1);
  });
});
