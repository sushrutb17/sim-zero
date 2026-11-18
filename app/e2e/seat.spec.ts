/**
 * T40 seat slide: SEAT BACK / SEAT FWD on the welcome screen move the head 5 cm along +Z, hands only.
 *
 * T37 seat anchoring in the IWER desktop emulator: wherever the emulated head is when the immersive session starts
 * (position, height, heading), the app must put it on the cockpit's seated eye point, facing the cockpit; and the
 * outside view must leave the runway once the aircraft is airborne.
 *
 * EMULATOR evidence only: it shows the rig math is applied to a WebXR session. It says nothing about a real Quest's
 * first tracked pose, its recentre gesture, or comfort.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, poke } from './helpers/hands';

type V3 = [number, number, number];
interface Trainer {
  coldStartMs?(): number | undefined;
  seat(): { position: V3; yaw: number };
  headWorld(): { position: V3; forward: V3 };
}
const HEAD_ANCHOR: V3 = [0, 1.2, 0];

/** Start the session with the emulated head at `pos`, turned `yawDeg` to the left and pitched `pitchDeg`. */
async function enterAt(page: Page, pos: V3, yawDeg: number, pitchDeg: number): Promise<void> {
  await page.evaluate(
    async ({ pos, yawDeg, pitchDeg }) => {
      type Dev = {
        grantOfferedSession(): void;
        activeSession: unknown;
        controlMode: string;
        primaryInputMode: string;
        position: { set(x: number, y: number, z: number): void };
        quaternion: { set(x: number, y: number, z: number, w: number): void };
      };
      const d = (window as unknown as { IWER_DEVICE: Dev }).IWER_DEVICE;
      const y = (yawDeg * Math.PI) / 360;
      const p = (pitchDeg * Math.PI) / 360;
      const place = () => {
        d.controlMode = 'programmatic';
        d.primaryInputMode = 'hand';
        d.position.set(pos[0], pos[1], pos[2]);
        // yaw about Y, then pitch about X
        d.quaternion.set(Math.cos(y) * Math.sin(p), Math.sin(y) * Math.cos(p), -Math.sin(y) * Math.sin(p), Math.cos(y) * Math.cos(p));
      };
      place();
      d.grantOfferedSession();
      for (let i = 0; i < 100 && !d.activeSession; i++) await new Promise((r) => setTimeout(r, 50));
      if (!d.activeSession) throw new Error('XR session did not start');
      place();
    },
    { pos, yawDeg, pitchDeg },
  );
  await page.waitForTimeout(800);
}

const trainer = <T>(page: Page, fn: (t: Trainer) => T) => page.evaluate(`(${fn.toString()})(window.__trainer)`) as Promise<T>;

test.describe('seat anchoring in IWER (T37)', () => {
  for (const c of [
    { name: 'standing, a step back and to the right, turned 40 degrees left', pos: [0.8, 1.62, 0.7] as V3, yaw: 40, pitch: -10 },
    { name: 'low seat, across the room, facing backwards', pos: [-1.5, 1.05, -2.2] as V3, yaw: 170, pitch: 0 },
  ]) {
    test(`the head lands on the seated eye point: ${c.name}`, async ({ page }) => {
      await page.goto('/');
      await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
      await enterAt(page, c.pos, c.yaw, c.pitch);
      const head = await trainer(page, (t) => t.headWorld());
      const seat = await trainer(page, (t) => t.seat());
      expect(Math.hypot(...seat.position), 'the rig was moved').toBeGreaterThan(0.2);
      for (let i = 0; i < 3; i++) expect(head.position[i], `head axis ${i}`).toBeCloseTo(HEAD_ANCHOR[i], 3);
      expect(head.forward[0], 'no heading left').toBeCloseTo(0, 3);
      expect(head.forward[2], 'facing the cockpit').toBeLessThan(0);
      expect(head.forward[1], 'pitch kept').toBeCloseTo(Math.sin((c.pitch * Math.PI) / 180), 3);
    });
  }
});

// T40: the playwright config stores the seat offset as 0 for every test, so the head starts on the anchor.
test.describe('seat slide buttons in IWER (T40)', () => {
  const headZ = (page: Page) => trainer(page, (t) => t.headWorld().position[2]);
  const stored = (page: Page) => page.evaluate(() => localStorage.getItem('trainer.seatOffsetM'));

  test('SEAT BACK and SEAT FWD each move the head exactly 5 cm, by hand pokes on the welcome screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
    await enterXR(page);
    expect(await headZ(page), 'starts on the anchor (seat stored as 0)').toBeCloseTo(0, 3);
    expect(await stored(page)).toBe('0');

    await poke(page, 'ui:seatBack', { until: async () => Math.abs((await headZ(page)) - 0.05) < 1e-3 });
    await page.waitForTimeout(300);
    expect(await headZ(page), 'one press moved the head 5 cm back, not 10').toBeCloseTo(0.05, 3);
    expect(await stored(page), 'the choice is remembered').toBe('0.05');
    expect(await trainer(page, (t) => t.headWorld().position[1]), 'height unchanged').toBeCloseTo(1.2, 3);
    expect(await trainer(page, (t) => t.headWorld().position[0]), 'sideways unchanged').toBeCloseTo(0, 3);

    // The hand lives in tracking space, which the rig has shifted by the seat offset. Every press below must give exactly
    // one step: SEAT FWD is pressed from 0.10 so that a double press (0.00) would be caught, since 0.05 -> 0 -> 0 hides it.
    const press = async (id: 'ui:seatBack' | 'ui:seatFwd', from: number, to: number) => {
      await poke(page, id, { rigOffset: [0, 0, from], until: async () => Math.abs((await headZ(page)) - to) < 1e-3 });
      await page.waitForTimeout(300);
      expect(await headZ(page), `${id} from ${from} gives ${to}`).toBeCloseTo(to, 3);
      expect(await stored(page)).toBe(String(to));
    };
    await press('ui:seatBack', 0.05, 0.1);
    await press('ui:seatFwd', 0.1, 0.05);
    await press('ui:seatFwd', 0.05, 0);
  });
});

// T51: the range ends at 0.50 m. Stored at 0.45, one SEAT BACK press reaches the end and the next one changes nothing.
test.describe('seat slide limit in IWER (T51)', () => {
  test.use({ storageState: { cookies: [], origins: [{ origin: 'https://localhost:' + (process.env.E2E_PORT ?? 8084), localStorage: [{ name: 'trainer.seatOffsetM', value: '0.45' }] }] } });
  const headZ = (page: Page) => trainer(page, (t) => t.headWorld().position[2]);
  const stored = (page: Page) => page.evaluate(() => localStorage.getItem('trainer.seatOffsetM'));

  test('SEAT BACK stops at 0.50 m: 0.45 gives 0.50, the next press changes nothing, SEAT FWD comes back to 0.45', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
    await enterAt(page, [0, 1.2, 0], 0, -20);
    expect(await headZ(page), 'the stored 0.45 is applied').toBeCloseTo(0.45, 3);

    await poke(page, 'ui:seatBack', { rigOffset: [0, 0, 0.45], until: async () => Math.abs((await headZ(page)) - 0.5) < 1e-3 });
    await page.waitForTimeout(300);
    expect(await headZ(page), 'one press: 0.45 to 0.50').toBeCloseTo(0.5, 3);
    expect(await stored(page)).toBe('0.5');

    // at the end of the range a further press does nothing (a press with no effect to wait for: one sweep, then look)
    await poke(page, 'ui:seatBack', { rigOffset: [0, 0, 0.5], actions: 0, attempts: 1, settleMs: 600 });
    await page.waitForTimeout(300);
    expect(await headZ(page), 'still 0.50, not 0.55').toBeCloseTo(0.5, 3);
    expect(await stored(page)).toBe('0.5');

    await poke(page, 'ui:seatFwd', { rigOffset: [0, 0, 0.5], until: async () => Math.abs((await headZ(page)) - 0.45) < 1e-3 });
    await page.waitForTimeout(300);
    expect(await headZ(page), 'SEAT FWD from the end: 0.45').toBeCloseTo(0.45, 3);
    expect(await stored(page)).toBe('0.45');
  });
});

// T40, T47, T51: a browser with nothing stored opens with the seat 0.30 m back (0.15 in T47, 0.10 in T40), and junk in storage falls back to the same.
test.describe('seat default in IWER (T40)', () => {
  for (const c of [
    { name: 'nothing stored', origins: [] as Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> },
    { name: 'junk stored', origins: [{ origin: 'https://localhost:' + (process.env.E2E_PORT ?? 8084), localStorage: [{ name: 'trainer.seatOffsetM', value: 'abc' }] }] },
  ]) {
    test.describe(c.name, () => {
      test.use({ storageState: { cookies: [], origins: c.origins } });
      test('the head is 0.30 m behind the eye point', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
        await enterAt(page, [0, 1.2, 0], 0, -20);
        const head = await trainer(page, (t) => t.headWorld());
        expect(head.position[2]).toBeCloseTo(0.3, 3);
        expect(head.position[1]).toBeCloseTo(1.2, 3);
        expect(head.forward[2], 'facing the cockpit').toBeLessThan(0);
      });
    });
  }
});
