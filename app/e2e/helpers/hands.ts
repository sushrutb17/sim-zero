/**
 * Hands-only input helpers for the IWER emulator (Task 13).
 *
 * Every user action is an emulated HAND action: the right hand's emulated transform (and pinch value) is moved
 * through `window.IWER_DEVICE`, the same object the IWSDK CLI's `xr set-transform` / `xr select` drive. The app
 * decides for itself whether a fingertip entering a pad, or a pinch ray, is a press. `page.evaluate` here only
 * moves the emulated hand and READS dev hooks (`window.__trainer.*`); it never calls app, session or engine methods
 * and never emits a bus action.
 *
 * Target ids (resolved by the dev hooks):
 *   plain id        -> window.__trainer.targetPosition(id)   (ui:*, card:<msg>/<card>, check:<list>:<item>,
 *                                                              route:<id>, kb:*, pa, page:<n>)
 *   ctl:<id>[#part] -> window.__trainer.controlPosition(id, part)   (cockpit controls; part = plus/minus/option)
 *   pad:<id>        -> window.__trainer.padPosition(id)             (alerts.ack ...)
 */
import type { Page } from '@playwright/test';

type V3 = [number, number, number];

/**
 * The page the existing specs fly: the app opens in Single Source and pins its BASELINE variation (T41, dev builds only), so the
 * practise-alone draw that RESTART triggers always gives the same flight these specs were written against.
 */
export const BASELINE_URL = '/?flight=single-source&variation=0';

export interface PokeOptions {
  /** Exact number of new bus actions the press must produce (default: at least one, or another effect). */
  actions?: number;
  /** Partial match every new bus action must satisfy (kind / controlId / messageId / cardId ...): proves the RIGHT pad was pressed, not a neighbour. */
  match?: Record<string, unknown>;
  /** Extra effect check, polled after the sweep (flow change, a page turned, a guard lifted ...). */
  until?: () => Promise<boolean>;
  /** Sweep attempts before failing (default 2: normal-aligned, then the straight +z approach). */
  attempts?: number;
  /** First approach: along the pad's normal (default) or straight along +z (the alert ACK pad, 53 mm from ALT +). */
  approach?: 'normal' | 'straight';
  /** Wait this long (ms) for the effect after each sweep. */
  settleMs?: number;
  /**
   * Where the app has moved the player rig, world metres (default none). Targets are world positions; the emulated hand
   * lives in tracking space, which the rig offsets (the seat slide, T40: [0, 0, seatOffset] for a head on the anchor).
   */
  rigOffset?: V3;
}

const toTracking = (world: V3, rig?: V3): V3 => (rig ? [world[0] - rig[0], world[1] - rig[1], world[2] - rig[2]] : world);

export interface Snapshot {
  actions: number;
  flow: string;
}

/** Wrist offset so the INDEX FINGERTIP (not the wrist) lands on the target (docs/iwsdk-notes.md). */
const WRIST_OFFSET: V3 = [0.035, -0.045, 0.05];
/** Parking spot far from every pad, used after a press (never sweep back out through the pad). */
const PARK: V3 = [0.55, 0.6, 0.3];

/** Put the emulator in the state a judge's Quest would be in: immersive session, hand tracking, seated head. */
export async function enterXR(page: Page): Promise<void> {
  await page.evaluate(async (PARK) => {
    type Dev = {
      grantOfferedSession(): void;
      activeSession: unknown;
      controlMode: string;
      primaryInputMode: string;
      position: { set(x: number, y: number, z: number): void };
      quaternion: { set(x: number, y: number, z: number, w: number): void };
      hands: { right: { position: { set(x: number, y: number, z: number): void }; quaternion: { set(x: number, y: number, z: number, w: number): void } } };
    };
    const d = (window as unknown as { IWER_DEVICE: Dev }).IWER_DEVICE;
    // The head goes on the seat BEFORE the session starts: the app anchors the cockpit to the first tracked head pose
    // (T37, src/xr/seatSystem.ts). From HEAD_ANCHOR the rig offset is zero, so the emulator's coordinates stay world
    // coordinates and every hand target below can be used as it is.
    d.controlMode = 'programmatic'; // else the emulator UI resets the head and hand every frame
    d.primaryInputMode = 'hand';
    d.position.set(0, 1.2, 0); // seated head
    const a = (-20 * Math.PI) / 180;
    d.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
    d.grantOfferedSession();
    for (let i = 0; i < 100 && !d.activeSession; i++) await new Promise((r) => setTimeout(r, 50));
    if (!d.activeSession) throw new Error('XR session did not start');
    d.controlMode = 'programmatic';
    d.primaryInputMode = 'hand';
    d.position.set(0, 1.2, 0);
    d.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
    d.hands.right.quaternion.set(0, 0, 0, 1);
    d.hands.right.position.set(PARK[0], PARK[1], PARK[2]);
  }, PARK);
  await page.waitForTimeout(500);
  // The seat must have anchored with no offset, or every hand target would be off by that offset.
  const seat = await page.evaluate(() => (window as unknown as { __trainer: { seat(): { position: number[]; yaw: number } } }).__trainer.seat());
  const off = Math.max(...seat.position.map(Math.abs), Math.abs(seat.yaw));
  if (off > 1e-3) throw new Error(`seat anchoring left an offset in the emulator: ${JSON.stringify(seat)}`);
}

export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const t = (window as unknown as { __trainer: { actions: unknown[]; flow(): string } }).__trainer;
    return { actions: t.actions.length, flow: t.flow() };
  });
}

/** World position of a target, or null while it is not shown. READ ONLY. */
export async function targetPos(page: Page, id: string): Promise<V3 | null> {
  return page.evaluate((id) => {
    const t = (window as unknown as { __trainer: Record<string, (...a: unknown[]) => V3> }).__trainer;
    try {
      if (id.startsWith('ctl:')) {
        const [cid, part] = id.slice(4).split('#');
        return part ? t.controlPosition(cid, part) : t.controlPosition(cid);
      }
      if (id.startsWith('pad:')) return t.padPosition(id.slice(4));
      return t.targetPosition(id);
    } catch {
      return null;
    }
  }, id);
}

export async function requireTarget(page: Page, id: string): Promise<V3> {
  const p = await targetPos(page, id);
  if (!p) throw new Error(`target '${id}' is not shown`);
  return p;
}

export async function waitForTarget(page: Page, id: string, timeoutMs = 20000): Promise<V3> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const p = await targetPos(page, id);
    if (p) return p;
    if (Date.now() > end) throw new Error(`target '${id}' did not appear within ${timeoutMs} ms`);
    await page.waitForTimeout(150);
  }
}

/**
 * Move the emulated right hand (wrist) from `from` to `to` over `frames` XR frames, then park it. Stepping once per
 * XR frame (not per timer tick) keeps the sweep continuous when the machine is busy and the frame rate drops: the
 * app only sees the fingertip on frame boundaries.
 */
async function sweepHand(page: Page, from: V3, to: V3, frames: number): Promise<void> {
  await page.evaluate(
    async ({ from, to, frames, park }) => {
      type D = { activeSession: { requestAnimationFrame(cb: () => void): number }; hands: { right: { position: { set(x: number, y: number, z: number): void } } } };
      const d = (window as unknown as { IWER_DEVICE: D }).IWER_DEVICE;
      const h = d.hands.right;
      const nextFrame = () => new Promise<void>((r) => d.activeSession.requestAnimationFrame(() => r()));
      h.position.set(from[0], from[1], from[2]);
      for (let i = 0; i < 12; i++) await nextFrame(); // let the hand settle at the start (and hover end)
      for (let i = 1; i <= frames; i++) {
        const f = i / frames;
        h.position.set(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f);
        await nextFrame();
      }
      for (let i = 0; i < 6; i++) await nextFrame();
      h.position.set(park[0], park[1], park[2]);
    },
    { from, to, frames, park: PARK },
  );
}

function sweepPath(target: V3, mode: 'normal' | 'straight'): { from: V3; to: V3 } {
  let n: V3;
  if (mode === 'straight') {
    n = [0, 0, 1];
  } else {
    const anchor: V3 = [0, 1.2, 0];
    const d: V3 = [anchor[0] - target[0], anchor[1] - target[1], anchor[2] - target[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    n = [d[0] / l, d[1] / l, d[2] / l];
  }
  const off = WRIST_OFFSET;
  return {
    from: [target[0] + n[0] * 0.4 + off[0], target[1] + n[1] * 0.4 + off[1], target[2] + n[2] * 0.4 + off[2]],
    to: [target[0] - n[0] * 0.1 + off[0], target[1] - n[1] * 0.1 + off[1], target[2] - n[2] * 0.1 + off[2]],
  };
}

/** New bus actions since `before` that do NOT satisfy `match` (empty when there is no match or all fit). */
async function mismatched(page: Page, before: Snapshot, match?: Record<string, unknown>): Promise<unknown[]> {
  if (!match) return [];
  return page.evaluate(
    ({ n, match }) => {
      const acts = (window as unknown as { __trainer: { actions: Record<string, unknown>[] } }).__trainer.actions.slice(n);
      return acts.filter((a) => !Object.entries(match).every(([k, v]) => JSON.stringify(a[k]) === JSON.stringify(v)));
    },
    { n: before.actions, match },
  );
}

async function effect(page: Page, before: Snapshot, opts: PokeOptions, settleMs: number): Promise<{ ok: boolean; delta: number }> {
  void opts.match;
  const end = Date.now() + settleMs;
  let delta = 0;
  for (;;) {
    const now = await snapshot(page);
    delta = now.actions - before.actions;
    const hit = delta > 0 || now.flow !== before.flow || (opts.until ? await opts.until() : false);
    if (hit) {
      await page.waitForTimeout(200); // a double press would show up as a second action
      const again = await snapshot(page);
      return { ok: true, delta: again.actions - before.actions };
    }
    if (Date.now() > end) return { ok: false, delta };
    await page.waitForTimeout(60);
  }
}

/**
 * Poke a target with the index fingertip along the pad's normal. Verifies the press from the app's own state:
 * exactly `opts.actions` new bus actions (default: 1, or a flow change / `until`), and fails loudly otherwise.
 * If no press registers, retries once approaching straight along +z (needed for the alert ACK pad).
 */
export async function poke(page: Page, targetId: string, opts: PokeOptions = {}): Promise<Snapshot> {
  if (process.env.E2E_VERBOSE) console.log(`  poke ${targetId}`);
  const attempts = opts.attempts ?? 2;
  const settle = opts.settleMs ?? 1500;
  let lastDelta = 0;
  for (let i = 0; i < attempts; i++) {
    const before = await snapshot(page);
    const target = toTracking(await requireTarget(page, targetId), opts.rigOffset);
    const first = opts.approach ?? 'normal';
    const second = first === 'normal' ? 'straight' : 'normal';
    const { from, to } = sweepPath(target, i % 2 === 0 ? first : second);
    await sweepHand(page, from, to, 54);
    const r = await effect(page, before, opts, settle);
    lastDelta = r.delta;
    if (r.ok) {
      const want = opts.actions;
      const bad = await mismatched(page, before, opts.match);
      if (bad.length) throw new Error(`poke '${targetId}': pressed the wrong pad, got ${JSON.stringify(bad)} (wanted ${JSON.stringify(opts.match)})`);
      if (want !== undefined && r.delta !== want) throw new Error(`poke '${targetId}': expected ${want} bus action(s), got ${r.delta}`);
      if (want === undefined && r.delta > 1) throw new Error(`poke '${targetId}': expected one press, got ${r.delta} bus actions (double press or a neighbouring pad)`);
      return snapshot(page);
    }
    if (opts.actions === 0) return snapshot(page); // a press that must not emit: nothing to wait for
  }
  throw new Error(`poke '${targetId}': no press registered after ${attempts} sweep(s) (bus actions +${lastDelta})`);
}

/** Poke a target that lives on a paged panel: tap `pager` (a pad id, or a function giving the next pad) until the target resolves. */
export async function pokeOnPage(page: Page, targetId: string, pagers: string[], opts: PokeOptions = {}): Promise<Snapshot> {
  for (const pager of [null, ...pagers]) {
    if (pager) await poke(page, pager, { until: async () => (await targetPos(page, targetId)) !== null, ...{ settleMs: 900 } });
    if ((await targetPos(page, targetId)) !== null) return poke(page, targetId, opts);
  }
  throw new Error(`target '${targetId}' not reachable through pagers ${pagers.join(', ')}`);
}

/** Stepper: poke `part` ('plus' | 'minus') `times` times; each press must emit exactly one control action. */
export async function stepper(page: Page, controlId: string, part: 'plus' | 'minus', times: number): Promise<void> {
  for (let i = 0; i < times; i++) await poke(page, `ctl:${controlId}#${part}`, { actions: 1, match: { kind: 'control', controlId } });
}

/**
 * Pinch-ray press: park the hand to the side, aim its ray at the target, pinch (value 1 for 250 ms, then release).
 * Same input path as the CLI's `xr look-at` + `xr select`. Retries once if no press registers.
 */
export async function pinchAt(page: Page, targetId: string, opts: PokeOptions = {}): Promise<Snapshot> {
  let lastDelta = 0;
  for (let attempt = 0; attempt < (opts.attempts ?? 2); attempt++) {
    const before = await snapshot(page);
    const t = toTracking(await requireTarget(page, targetId), opts.rigOffset);
    await page.evaluate(
      async ({ t, park }) => {
        type Hand = {
          position: { set(x: number, y: number, z: number): void };
          quaternion: { set(x: number, y: number, z: number, w: number): void };
          updatePinchValue(v: number): void;
        };
        type D = { activeSession: { requestAnimationFrame(cb: () => void): number }; hands: { right: Hand } };
        const d = (window as unknown as { IWER_DEVICE: D }).IWER_DEVICE;
        const h = d.hands.right;
        const frames = async (n: number) => {
          for (let i = 0; i < n; i++) await new Promise<void>((r) => d.activeSession.requestAnimationFrame(() => r()));
        };
        const p: [number, number, number] = [0.2, 1.0, 0.1];
        const dx = t[0] - p[0];
        const dy = t[1] - p[1];
        const dz = t[2] - p[2];
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        // q = Ry(yaw) * Rx(pitch): the hand looks along -z
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        h.position.set(p[0], p[1], p[2]);
        h.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
        await frames(30); // the ray has to settle on the target first
        h.updatePinchValue(1);
        await frames(15);
        h.updatePinchValue(0);
        await frames(8);
        h.quaternion.set(0, 0, 0, 1);
        h.position.set(park[0], park[1], park[2]);
      },
      { t, park: PARK },
    );
    const r = await effect(page, before, opts, opts.settleMs ?? 1500);
    lastDelta = r.delta;
    if (!r.ok) continue;
    const bad = await mismatched(page, before, opts.match);
    if (bad.length) throw new Error(`pinchAt '${targetId}': pressed the wrong pad, got ${JSON.stringify(bad)}`);
    if (opts.actions !== undefined && r.delta !== opts.actions) throw new Error(`pinchAt '${targetId}': expected ${opts.actions} action(s), got ${r.delta}`);
    if (opts.actions === undefined && r.delta > 1) throw new Error(`pinchAt '${targetId}': expected one press, got ${r.delta} actions`);
    return snapshot(page);
  }
  throw new Error(`pinchAt '${targetId}': no press registered (bus actions +${lastDelta})`);
}

/**
 * After CONTINUE (or RESTART): when the flight picker is shown (more than one flight is registered) poke the card of `flightId`;
 * when only one flight is registered there is no picker and the mode screen is already up. Returns once the mode screen shows.
 */
export async function pickFlight(page: Page, flightId = 'single-source'): Promise<void> {
  const flow = () => page.evaluate(() => (window as unknown as { __trainer: { flow(): string } }).__trainer.flow());
  const end = Date.now() + 8000;
  for (;;) {
    const f = await flow();
    if (f === 'modeSelect') return;
    if (f === 'flightSelect') break;
    if (Date.now() > end) throw new Error(`expected the flight picker or the mode screen, flow is '${f}'`);
    await page.waitForTimeout(100);
  }
  await waitForTarget(page, `ui:flight:${flightId}`, 8000);
  await poke(page, `ui:flight:${flightId}`);
}
