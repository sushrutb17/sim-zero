/**
 * Loads a list of assets in the order given, a few at a time. Pure (no engine import): the caller passes the loader. Each id is
 * requested once; a load that rejects (or throws) is recorded in `failed` and does not stop the others. Resolves when all settled.
 */
export async function loadInOrder(
  ids: readonly string[],
  loadOne: (id: string) => Promise<unknown>,
  concurrency = 4,
): Promise<{ loaded: number; failed: string[] }> {
  const queue = [...new Set(ids)];
  const failed: string[] = [];
  let loaded = 0;
  let next = 0;
  const limit = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
  async function worker(): Promise<void> {
    while (next < queue.length) {
      const id = queue[next++];
      try { await loadOne(id); loaded++; } catch { failed.push(id); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return { loaded, failed };
}
