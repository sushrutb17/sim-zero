/**
 * T49: the page Start button, audio unlock gestures, and the welcome greeting, in the IWER desktop emulator.
 *
 * EMULATOR evidence only, and it CANNOT prove the Quest fix: headless Chromium here does not enforce the autoplay policy, so
 * the AudioContext may already be running before any gesture. What this proves: the Start button shows once the app has loaded,
 * a real Playwright click on it (a user activation) starts the IWER session and hides it, the shared context is running, the
 * button returns when the session ends, the browser's offered session still works alongside it, a page click and an in-session
 * pinch each resume a suspended context (the wiring), and the welcome screen greets and shows/clears the sound-off line.
 * Whether a Quest Browser honours any of these as activation is the user's check on the device.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASELINE_URL } from './helpers/hands';

type Ctx = { state: string; suspend(): Promise<void>; resume(): Promise<void> };
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const ctxState = (page: Page) => read<string | null>(page, 't.audioContext()?.state ?? null');
const flow = (page: Page) => read<string>(page, 't.flow()');
const sessionActive = (page: Page) => page.evaluate(() => Boolean((window as unknown as { IWER_DEVICE: { activeSession: unknown } }).IWER_DEVICE.activeSession));
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/audio-unlock-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs = 10000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const suspend = (page: Page) => page.evaluate(async () => { await (window as unknown as { __trainer: { audioContext(): Ctx } }).__trainer.audioContext().suspend(); });

test('Start button: a real click starts the session and resumes audio; the page and a pinch resume it again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASELINE_URL);
  const start = page.locator('#start-button');
  await expect(start).toBeVisible({ timeout: 60_000 });
  // after the loading screen has gone; the build stamp footer stays
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#build-footer')).toBeVisible();
  await expect(start).toContainText('Start Sim Zero');
  await expect(start).toContainText('Tap to start, with sound');
  await expect(page.locator('#build-footer')).toContainText('Build');
  expect(await sessionActive(page)).toBe(false);
  console.log('audio context before the click:', await ctxState(page));
  await shot(page, '1-start-screen');

  // a real page click (user activation), not a dev hook
  await start.click();
  await until('XR session', () => sessionActive(page));
  await expect(page.locator('#start-screen')).toBeHidden();
  await until('audio running', async () => (await ctxState(page)) === 'running');
  expect(await flow(page)).toBe('welcome');
  await page.waitForTimeout(600);
  await shot(page, '2-welcome-after-start');

  // locked headset stand-in: suspend the shared context. The welcome screen shows the line; a pinch in the session clears it.
  await suspend(page);
  await until('suspended', async () => (await ctxState(page)) === 'suspended');
  await page.waitForTimeout(800);
  await shot(page, '3-welcome-sound-off');
  expect(await ctxState(page)).toBe('suspended'); // nothing but the pinch below may bring it back
  await page.evaluate(async () => {
    type Hand = { position: { set(x: number, y: number, z: number): void }; updatePinchValue(v: number): void };
    type D = { controlMode: string; primaryInputMode: string; activeSession: { requestAnimationFrame(cb: () => void): number }; hands: { right: Hand } };
    const d = (window as unknown as { IWER_DEVICE: D }).IWER_DEVICE;
    d.controlMode = 'programmatic'; // else the emulator UI resets the hand every frame
    d.primaryInputMode = 'hand';
    const frames = async (n: number) => { for (let i = 0; i < n; i++) await new Promise<void>((r) => d.activeSession.requestAnimationFrame(() => r())); };
    d.hands.right.position.set(0.55, 0.6, 0.3); // far from every pad: a pinch in the air, not a press
    await frames(10);
    d.hands.right.updatePinchValue(1);
    await frames(15);
    d.hands.right.updatePinchValue(0);
  });
  await until('pinch resumed audio', async () => (await ctxState(page)) === 'running');
  expect(await flow(page)).toBe('welcome'); // the pinch pressed nothing
  await page.waitForTimeout(800);
  await shot(page, '4-welcome-sound-back');

  // a page tap (DOM gesture) also resumes it, even in a session
  await suspend(page);
  await until('suspended again', async () => (await ctxState(page)) === 'suspended');
  await page.mouse.click(300, 300);
  await until('page click resumed audio', async () => (await ctxState(page)) === 'running');

  // the session ends: the Start screen comes back
  await page.evaluate(async () => { await (window as unknown as { IWER_DEVICE: { activeSession: { end(): Promise<void> } } }).IWER_DEVICE.activeSession.end(); });
  await expect(page.locator('#start-button')).toBeVisible({ timeout: 10_000 });
  expect(await sessionActive(page)).toBe(false);
  await shot(page, '5-start-screen-after-exit');

  // the browser's own offered Enter VR still works after a Start session (IWER keeps its offer pending)
  const offered = await page.evaluate(() => (window as unknown as { IWER_DEVICE: { sessionOffered: boolean } }).IWER_DEVICE.sessionOffered);
  console.log('IWER offer still pending after the Start session:', offered);
  if (offered) {
    await page.evaluate(() => (window as unknown as { IWER_DEVICE: { grantOfferedSession(): void } }).IWER_DEVICE.grantOfferedSession());
    await until('offered session', () => sessionActive(page));
    await expect(page.locator('#start-screen')).toBeHidden();
  }
  console.log('page errors:', JSON.stringify(errors));
});

test('browser-offered Enter VR (no page click): the Start screen hides, then a second Start press cannot make a second session', async ({ page }) => {
  await page.goto(BASELINE_URL);
  await expect(page.locator('#start-button')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { IWER_DEVICE: { grantOfferedSession(): void } }).IWER_DEVICE.grantOfferedSession());
  await until('offered session', () => sessionActive(page));
  await expect(page.locator('#start-screen')).toBeHidden();
  const first = await page.evaluate(() => (window as unknown as { IWER_DEVICE: { activeSession: unknown } }).IWER_DEVICE.activeSession);
  expect(first).toBeTruthy();
  // count requestSession calls from here on: a Start press while a session exists must not request another
  await page.evaluate(() => {
    const xr = navigator.xr as unknown as { requestSession(...a: unknown[]): Promise<unknown> };
    const w = window as unknown as { __requests: number };
    w.__requests = 0;
    const orig = xr.requestSession.bind(xr);
    xr.requestSession = (...a: unknown[]) => { w.__requests++; return orig(...a); };
    (document.getElementById('start-button') as HTMLButtonElement).click(); // hidden, but the handler must still be harmless
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __requests: number }).__requests)).toBe(0);
  expect(await sessionActive(page)).toBe(true);
  expect(await flow(page)).toBe('welcome');
});
