/** The seat offset the user chose, remembered in the browser (T40). Every storage access is guarded: it can throw or be empty. */
import { SEAT_DEFAULT_M, SEAT_MAX_M, SEAT_MIN_M, clampSeat } from '../xr/seatMath';

export const SEAT_KEY = 'trainer.seatOffsetM';

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored offset on the 0.05 m grid, or the default when it is missing, not a number, out of range or unreadable. */
export function loadSeatOffset(storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): number {
  try {
    const raw = storage?.getItem(SEAT_KEY);
    if (raw === null || raw === undefined || raw.trim() === '') return SEAT_DEFAULT_M;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < SEAT_MIN_M - 1e-9 || v > SEAT_MAX_M + 1e-9) return SEAT_DEFAULT_M;
    return clampSeat(v);
  } catch {
    return SEAT_DEFAULT_M;
  }
}

export function saveSeatOffset(m: number, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
  try {
    storage?.setItem(SEAT_KEY, String(clampSeat(m)));
  } catch {
    /* private mode or quota: the seat still moves for this session */
  }
}
