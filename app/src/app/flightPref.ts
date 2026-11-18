/** The variation last flown in each flight, remembered in the browser (T41). Every storage access is guarded: it can throw or be empty. */

export const lastVariationKey = (flightId: string): string => `trainer.lastVariation.${flightId}`;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored variation index, or null when it is missing, not a whole number or unreadable. Whether it is in range is the caller's business (pickVariation ignores an out-of-range `last`). */
export function loadLastVariation(flightId: string, storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): number | null {
  try {
    const raw = storage?.getItem(lastVariationKey(flightId));
    if (raw === null || raw === undefined || !/^\d{1,6}$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export function saveLastVariation(flightId: string, variation: number, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
  if (!Number.isInteger(variation) || variation < 0) return;
  try {
    storage?.setItem(lastVariationKey(flightId), String(variation));
  } catch {
    /* private mode or quota: the next flight just has no memory of this one */
  }
}
