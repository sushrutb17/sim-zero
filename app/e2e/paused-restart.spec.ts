/**
 * T51: RESTART on the Paused screen, driven ONLY by emulated hand pokes in the IWER desktop emulator.
 * Start a guided flight, let it run (frames lit, messages in), Pause from the kneeboard, poke RESTART: the run is abandoned
 * (no debrief), the flight picker comes up with nothing of the run left, and the next flight starts clean from Event Set 1.
 *
 * Input purity: every user action is a poke (helpers/hands.ts). `page.evaluate` only READS the dev hooks.
 * EMULATOR evidence only: it does not show how the Paused screen reads or how the buttons feel in a real headset.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASELINE_URL, enterXR, pickFlight, poke, requireTarget, waitForTarget } from './helpers/hands';

interface Guide {
  stepId: string;
  pads: string[];
}
type Trainer = { coldStartMs?(): number | undefined };
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const flow = (page: Page) => read<string>(page, 't.flow()');
const guide = (page: Page) => read<Guide | null>(page, 't.guide()');
const status = (page: Page) => read<{ run: string; eventSetId: string | null; tInSet: number }>(page, 't.session().status');
const original = (page: Page) => read<unknown[]>(page, 't.session().results.original');
const content = (page: Page) => read<{ messages: string[]; alerts: string[]; ticked: string[]; briefing: { id: string }[] }>(page, 't.panelContent()');
const baro = (page: Page) => read<number>(page, 't.aircraft().baroHpa');
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('trainer.seatOffsetM'));
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/paused-restart-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const inState = (page: Page, s: string, ms = 5000) => until(`flow ${s}`, async () => (await flow(page)) === s, ms);

test.describe('RESTART on the Paused screen in IWER (T51)', () => {
  test('abandons a guided run from the kneeboard Pause, lands on the picker, and the next flight starts clean', async ({ page }) => {
    await page.goto(BASELINE_URL);
    await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
    await enterXR(page);

    // GUIDED FLIGHT through the screens by hand, then fly a little.
    await poke(page, 'ui:continue');
    await pickFlight(page);
    await waitForTarget(page, 'ui:guided');
    await poke(page, 'ui:guided');
    await inState(page, 'practice');
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await inState(page, 'briefing');
    await poke(page, 'ui:begin');
    await inState(page, 'running');
    await until('a framed pad and a message of the run', async () => ((await guide(page))?.pads.length ?? 0) > 0 && (await content(page)).messages.length > 0, 20_000);
    await until('the first printout (5 s into the set)', async () => (await status(page)).tInSet > 6, 30_000);
    const before = await content(page);
    const run = await status(page);
    expect(before.messages.length, 'the run left a message').toBeGreaterThan(0);
    expect(run.tInSet, 'time had passed').toBeGreaterThan(6);
    expect(run.eventSetId).toBe('es1-before-takeoff');

    // Pause from the kneeboard: the Paused screen has RESUME and RESTART, well apart.
    await poke(page, 'kb:pause');
    await inState(page, 'paused');
    expect(await guide(page), 'no frames while paused').toBeNull();
    await page.waitForTimeout(600);
    const restart = await requireTarget(page, 'ui:abandon');
    const resume = await requireTarget(page, 'ui:resume');
    const apart = Math.hypot(restart[0] - resume[0], restart[1] - resume[1], restart[2] - resume[2]);
    console.log(`paused: RESTART ${JSON.stringify(restart.map((x) => +x.toFixed(3)))}, RESUME ${JSON.stringify(resume.map((x) => +x.toFixed(3)))}, ${(apart * 100).toFixed(1)} cm between the pad centres`);
    expect(apart, 'pad centres at least 10 cm apart').toBeGreaterThan(0.1);
    await shot(page, 'paused');

    // RESTART: straight to the picker, no debrief.
    const seatBefore = await stored(page);
    await poke(page, 'ui:abandon');
    await inState(page, 'flightSelect');
    await page.waitForTimeout(600);
    expect(await guide(page), 'no guidance at the picker').toBeNull();
    expect(await original(page), 'the abandoned run left no scores').toEqual([]);
    const cleared = await content(page);
    expect(cleared.messages, 'no messages of the abandoned run').toEqual([]);
    expect(cleared.alerts).toEqual([]);
    expect(cleared.briefing.length, 'the run\'s printout is gone from the kneeboard').toBeLessThan(before.briefing.length);
    expect(cleared.ticked).toEqual([]);
    const idle = await status(page);
    expect(idle.eventSetId).toBe('es1-before-takeoff');
    expect(idle.tInSet, 'the fresh engine waits for Begin').toBe(0);
    expect(await stored(page), 'the seat setting is kept').toBe(seatBefore);
    await shot(page, 'picker');

    // Pick a flight and a mode: it works exactly like after a debrief RESTART (practice is not asked again).
    await pickFlight(page);
    await inState(page, 'modeSelect');
    await page.waitForTimeout(600);
    await poke(page, 'ui:auto');
    await inState(page, 'briefing');
    expect((await content(page)).messages, 'still nothing from the old run').toEqual([]);
    await page.waitForTimeout(600);
    await poke(page, 'ui:begin');
    await inState(page, 'running');
    await page.waitForTimeout(1200);

    // The new run is clean: Event Set 1 from its start, no framed pads (unguided), its own cues only.
    const now = await status(page);
    expect(now.run).toBe('running');
    expect(now.eventSetId).toBe('es1-before-takeoff');
    expect(now.tInSet, 'the clock started again at Begin').toBeLessThan(4);
    expect(now.tInSet).toBeGreaterThan(0);
    expect(await guide(page), 'practise alone shows no guide frames from the old run').toBeNull();
    expect(await original(page)).toEqual([]);
    expect(await baro(page), 'cockpit back to its initial state').toBe(1009);
    const fresh = await content(page);
    expect(fresh.alerts).toEqual([]);
    expect(fresh.ticked).toEqual([]);
    expect(fresh.messages.length, 'at most the new run\'s opening messages').toBeLessThanOrEqual(before.messages.length);
    await shot(page, 'new-run');
  });
});
