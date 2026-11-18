/**
 * Task 13: the regression guard for the whole judge experience, driven ONLY by emulated hand input in the IWER
 * desktop emulator: welcome -> Auto -> practice -> briefing -> Event Sets 1-4 -> debrief -> redo -> finish.
 *
 * Input purity: every user action is a poke or a pinch (see helpers/hands.ts). `page.evaluate` only READS the dev
 * hooks (positions, flow, results) and moves the emulated hand.
 *
 * EMULATOR evidence only: this says nothing about real hand-tracking quality or Quest performance.
 */
import { expect, test, type Page, type Request } from '@playwright/test';
import { BASELINE_URL, enterXR, pickFlight, pinchAt, poke, pokeOnPage, snapshot, stepper, waitForTarget } from './helpers/hands';
import { VOICED_MESSAGE_IDS } from '../src/scenarios/single-source.voice';

const T0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s] ${m}`);

// ---- read-only probes -------------------------------------------------------------------------------------------

interface Aircraft {
  altitudeFt: number;
  headingDeg: number;
  baroHpa: number;
  destination: string;
  ap: { engaged: boolean; hdg: number; alt: number; vertical: string };
  lights: { landing: boolean; strobe: boolean };
  elec: { gen1: { switchOn: boolean; failed: boolean }; busTie: boolean };
}
interface Row {
  eventSetId: string;
  grade: number;
  redoGrade?: number;
  reasons?: { label: string; text: string }[];
}

const aircraft = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { aircraft(): unknown } }).__trainer.aircraft()) as Promise<Aircraft>;
const outsideView = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { outside(): { level: number; groundVisible: boolean } } }).__trainer.outside());
const flow = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { flow(): string } }).__trainer.flow());
const debriefView = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { debriefView(): string } }).__trainer.debriefView());
const reviewAttempt = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __trainer: { review(id: string): { attempt: string } | null } }).__trainer.review(id)?.attempt ?? null, id);
const eventSet = (page: Page) =>
  page.evaluate(() => (window as unknown as { __trainer: { session(): { status: { eventSetId?: string } } } }).__trainer.session().status.eventSetId ?? '');
const debrief = (page: Page) =>
  page.evaluate(() => (window as unknown as { __trainer: { session(): { debrief: Row[] } } }).__trainer.session().debrief) as Promise<Row[]>;

const crewCaption = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { crewCaption(): { head: string; body: string } | null } }).__trainer.crewCaption());
const flyingDrawCalls = (page: Page) => page.evaluate(() => (window as unknown as { __trainer: { flyingDrawCalls(): { max: number; samples: number } } }).__trainer.flyingDrawCalls());

async function until(what: string, pred: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const inEventSet = (page: Page, id: string, timeoutMs?: number) => until(`event set ${id}`, async () => (await eventSet(page)) === id, timeoutMs);

/**
 * Requests that are not the app reaching out. Entering XR makes IWSDK's input layer fetch the Meta Quest controller and
 * generic hand glTF models from the @webxr-input-profiles CDN (a framework feature, not app or scenario code; recorded
 * as a concern in the Task 13 report), the app makes blob: URLs for in-memory textures, and the dev server may serve one
 * lazy same-origin chunk (the bundled Inter font module). Everything else after the welcome screen counts.
 */
const IWSDK_INPUT_MODEL = /^GET https:\/\/cdn\.jsdelivr\.net\/npm\/@webxr-input-profiles\/assets@[\d.]+\/dist\/profiles\/[a-z0-9-]+\/(left|right)\.glb$/;
/** Same-origin lazy chunks of the app's own bundle (e.g. the bundled Inter font module): static assets, counted and logged. */
/** The dev server's port: playwright.config.ts reads the same E2E_PORT (default 8084). */
const E2E_PORT = Number(process.env.E2E_PORT ?? 8084);
// `.vite[^/]*` also covers a per-worktree VITE_CACHE_DIR such as node_modules/.vite-t16 (vite.config.ts).
const OWN_STATIC_ASSET = new RegExp(`^GET https://localhost:${E2E_PORT}/(node_modules/\\.vite[^/]*/deps/|src/|assets/|public/|fonts/)[^ ]*$`);
const isOwnStaticAsset = (r: string) => OWN_STATIC_ASSET.test(r);
const isAppRequest = (r: string) => !r.startsWith('GET blob:') && !IWSDK_INPUT_MODEL.test(r) && !isOwnStaticAsset(r);

// ---- boot --------------------------------------------------------------------------------------------------------

/** Load the dev build, wait for the first welcome-screen draw, start counting requests, then enter XR in hand mode. */
async function boot(page: Page): Promise<{ requests: string[] }> {
  const voiceLoaded = new Set<string>();
  page.on('requestfinished', (r: Request) => {
    if (/\/audio\/voice\/[A-Za-z0-9_-]+\.mp3$/.test(new URL(r.url()).pathname)) voiceLoaded.add(r.url());
  });
  await page.goto(BASELINE_URL);
  await page.waitForFunction(() => {
    const t = (window as unknown as { __trainer?: { coldStartMs?: () => number | undefined } }).__trainer;
    return typeof t?.coldStartMs?.() === 'number';
  }, null, { timeout: 90_000 });
  // Voice clips (T12; T45: loaded by the app after the welcome screen is drawn, four at a time); wait until every one has arrived so the no-network check below counts
  // only what the app fetches during the session. Counted from the test runner (the page's resource-timing buffer
  // overflows in the dev build, which serves hundreds of modules).
  const deadline = Date.now() + 60_000;
  while (voiceLoaded.size < VOICED_MESSAGE_IDS.length) {
    if (Date.now() > deadline) throw new Error(`voice clips loaded: ${voiceLoaded.size} of ${VOICED_MESSAGE_IDS.length}`);
    await page.waitForTimeout(200);
  }
  // The listener starts only after the welcome screen is drawn: everything loaded to get there is excluded.
  const requests: string[] = [];
  page.on('request', (r: Request) => requests.push(`${r.method()} ${r.url()}`));
  await enterXR(page);
  expect(await flow(page)).toBe('welcome');
  return { requests };
}

async function toRunning(page: Page, via: 'poke' | 'pinch' = 'poke'): Promise<void> {
  const press = via === 'pinch' ? pinchAt : poke;
  await press(page, 'ui:continue');
  await pickFlight(page);
  await until('mode screen', async () => (await flow(page)) === 'modeSelect', 5000);
  await press(page, 'ui:auto');
  await until('practice', async () => (await flow(page)) === 'practice', 5000);
  await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
  await until('briefing', async () => (await flow(page)) === 'briefing', 5000);
  await poke(page, 'ui:begin');
  await until('running', async () => (await flow(page)) === 'running', 5000);
  await page.waitForTimeout(600); // past the 0.35 s engage grace
}

// ---- the four Event Sets by hand ----------------------------------------------------------------------------------

const reply = async (page: Page, messageId: string, cardId: string) => {
  log(`reply ${messageId}/${cardId}`);
  await waitForTarget(page, `card:${messageId}/${cardId}`, 60_000);
  await poke(page, `card:${messageId}/${cardId}`, { actions: 1, match: { kind: 'reply', messageId, cardId } });
};
const checkItem = async (page: Page, list: string, item: string, first = false) => {
  log(`check ${list}:${item}`);
  // the first item of a list resolves once the list opens; later ones may sit on another page (pager below)
  if (first) await waitForTarget(page, `check:${list}:${item}`, 60_000);
  await pokeOnPage(page, `check:${list}:${item}`, ['check:next', 'check:prev'], { actions: 1, match: { kind: 'checklistItem', checklistId: list, itemId: item } });
};

async function es1(page: Page): Promise<void> {
  await inEventSet(page, 'es1-before-takeoff', 10_000);
  await reply(page, 'twr-hold', 'hold-readback');
  await stepper(page, 'baro.set', 'minus', 5); // planning QNH 1009 -> updated ATIS 1004
  await stepper(page, 'ap.hdg', 'plus', 9); // 000 -> 090
  await stepper(page, 'ap.alt', 'plus', 4); // 0 -> 4000
  await poke(page, 'ctl:lights.landing', { actions: 1, match: { kind: 'control', controlId: 'lights.landing', value: true } });
  await poke(page, 'ctl:lights.strobe', { actions: 1, match: { kind: 'control', controlId: 'lights.strobe', value: true } });
  const a = await aircraft(page);
  expect(a.baroHpa).toBe(1004);
  expect(a.ap.hdg).toBe(90);
  expect(a.ap.alt).toBe(4000);
  expect(a.lights).toEqual({ landing: true, strobe: true });
  let firstItem = true;
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) {
    await checkItem(page, 'beforeTakeoff', id, firstItem);
    firstItem = false;
  }
  await inEventSet(page, 'es2-takeoff-climb', 20_000);
}

async function es2(page: Page): Promise<void> {
  expect(await outsideView(page), 'runway picture while holding short').toEqual({ level: 0, groundVisible: true }); // T37
  await reply(page, 'twr-takeoff', 'to-readback');
  await reply(page, 'dep-climb', 'dev-left'); // waits for the Departure call (6 scenario-seconds after takeoff)
  await poke(page, 'ctl:ap.engage', { actions: 1, match: { kind: 'control', controlId: 'ap.engage', value: true } }); // T19: the aircraft only climbs with the autopilot engaged
  await expect.poll(() => crewCaption(page)).toEqual({ head: 'FIRST OFFICER', body: 'Autopilot engaged.' });
  await stepper(page, 'ap.alt', 'plus', 8); // 4000 -> 12000
  await poke(page, 'ctl:ap.vertical#climb', { actions: 1, match: { kind: 'control', controlId: 'ap.vertical', value: 'climb' } });
  await stepper(page, 'ap.hdg', 'minus', 3); // 090 -> 060, clear of the storm
  const a = await aircraft(page);
  expect(a.ap).toMatchObject({ engaged: true, alt: 12000, hdg: 60, vertical: 'climb' });
  await inEventSet(page, 'es3-gen-failure', 150_000);
  expect(await outsideView(page), 'no runway once airborne').toEqual({ level: 1, groundVisible: false }); // T37
}

async function es3(page: Page, redo = false): Promise<void> {
  await reply(page, 'dep-handoff', 'ho-readback');
  await until('GEN 1 FAULT', async () => (await aircraft(page)).elec.gen1.failed, 120_000);
  await page.waitForTimeout(600);
  await poke(page, 'pad:alerts.ack', { actions: 1, approach: 'straight', match: { kind: 'alertAck', alertId: 'gen1-fail' } });
  await checkItem(page, 'genFail', 'gf-identify', true);
  await poke(page, 'ctl:elec.gen1', { actions: 1, match: { kind: 'control', controlId: 'elec.gen1', value: false } });
  expect((await aircraft(page)).elec.gen1.switchOn).toBe(false);
  await checkItem(page, 'genFail', 'gf-gen1-off');
  // guarded switch: the first press lifts the guard (no action), the second throws the switch
  await poke(page, 'ctl:elec.busTie', { actions: 1, attempts: 3, match: { kind: 'control', controlId: 'elec.busTie', value: true } });
  expect((await aircraft(page)).elec.busTie).toBe(true);
  await checkItem(page, 'genFail', 'gf-bustie');
  await checkItem(page, 'genFail', 'gf-cabin');
  await checkItem(page, 'genFail', 'gf-review');
  await reply(page, 'cab-lights', 'cab-standby');
  await reply(page, 'ctr-query', 'ctr-report');
  // a first run goes on to Event Set 4; a redo ends at the debrief
  if (!redo) await inEventSet(page, 'es4-decision', 30_000);
}

async function es4(page: Page): Promise<void> {
  await reply(page, 'ctr-intentions', 'dec-return');
  await poke(page, 'route:dep', { actions: 1, match: { kind: 'control', controlId: 'route.destination', value: 'dep' } });
  expect((await aircraft(page)).destination).toBe('dep');
  await poke(page, 'pa', { actions: 1, match: { kind: 'control', controlId: 'pa.cabin', value: true } });
  await reply(page, 'pa-cabin', 'pa-clear');
  await until('debrief', async () => (await flow(page)) === 'debrief', 20_000);
}

// ---- specs -------------------------------------------------------------------------------------------------------

test.describe('hands-only Auto loop in IWER', () => {
  test('(a) BARO shows the scenario initial value right after load', async ({ page }) => {
    await boot(page);
    // The same value the BARO stepper displays: ControlSync pushes scenario.initialAircraft before the first frame.
    expect((await aircraft(page)).baroHpa).toBe(1009);
  });

  test('(b)+(d) full happy path by hand: return to departure, redo Event Set 3, finish, no network', async ({ page }) => {
    const { requests } = await boot(page);
    const t0 = Date.now();
    await toRunning(page);
    await es1(page);
    await es2(page);
    await es3(page);
    await es4(page);
    const tDebrief = Date.now();
    expect(await crewCaption(page)).toBeNull();
    const flyingCalls = await flyingDrawCalls(page);
    console.log(`unguided XR flying draw calls: max ${flyingCalls.max}, samples ${flyingCalls.samples}`);
    expect(flyingCalls.samples).toBeGreaterThan(0);
    expect(flyingCalls.max).toBeGreaterThan(0);
    expect(flyingCalls.max).toBeLessThanOrEqual(150);

    // debrief: four rows, every grade 4
    const rows = await debrief(page);
    expect(rows.map((r) => r.eventSetId)).toEqual(['es1-before-takeoff', 'es2-takeoff-climb', 'es3-gen-failure', 'es4-decision']);
    expect(rows.map((r) => r.grade), `grades with reasons: ${JSON.stringify(rows.map((r) => [r.eventSetId, r.grade, r.reasons]))}`).toEqual([4, 4, 4, 4]);

    // T29: open the Event Set 3 timeline by hand, then go back to the grades. Switching the view emits no bus action and
    // no flow change, so each poke is told which effect proves the press (else it retries on a pad that has gone).
    const inView = (v: string) => async () => (await debriefView(page)) === v;
    await poke(page, 'ui:timeline:es3-gen-failure', { until: inView('timeline:es3-gen-failure') });
    expect(await debriefView(page)).toBe('timeline:es3-gen-failure');
    expect(await reviewAttempt(page, 'es3-gen-failure')).toBe('first');
    await page.screenshot({ path: 'test-results/t29-timeline.png' });
    await poke(page, 'ui:back', { until: inView('grades') });
    expect(await debriefView(page)).toBe('grades');

    // Redo Event Set 3 by hand: its grade appears next to the first grade
    await poke(page, 'ui:redo:es3-gen-failure');
    await until('redo', async () => (await flow(page)) === 'redo', 5000);
    await page.waitForTimeout(600);
    await es3(page, true);
    await until('second debrief', async () => (await flow(page)) === 'debrief', 30_000);
    const rows2 = await debrief(page);
    const es3row = rows2.find((r) => r.eventSetId === 'es3-gen-failure');
    expect(es3row).toMatchObject({ grade: 4, redoGrade: 4 });
    expect(rows2.filter((r) => r.eventSetId !== 'es3-gen-failure').every((r) => r.redoGrade === undefined)).toBe(true);

    // T29: the timeline now shows the redo attempt
    await poke(page, 'ui:timeline:es3-gen-failure', { until: inView('timeline:es3-gen-failure') });
    expect(await debriefView(page)).toBe('timeline:es3-gen-failure');
    expect(await reviewAttempt(page, 'es3-gen-failure')).toBe('redo');
    await poke(page, 'ui:back', { until: inView('grades') });
    expect(await debriefView(page)).toBe('grades');

    await poke(page, 'ui:finish');
    await until('finished', async () => (await flow(page)) === 'finished', 5000);
    expect(await crewCaption(page)).toBeNull();
    console.log(`full session by hand: ${((Date.now() - t0) / 1000).toFixed(0)} s (Begin to debrief ${((tDebrief - t0) / 1000).toFixed(0)} s)`);

    // (d) nothing left the page after the welcome screen appeared
    const appRequests = requests.filter(isAppRequest);
    console.log(`requests after the welcome screen: ${requests.length} total, ${appRequests.length} unexpected. Allowed: ${requests.filter((r) => !isAppRequest(r)).join(' | ')}`);
    expect(appRequests, `unexpected network requests after the welcome screen:\n${appRequests.join('\n')}`).toEqual([]);
  });

  test('(e) pinch-ray presses work end to end through the menus and a reply card', async ({ page }) => {
    // Pinch-only on purpose: mixing pinch and poke on one hand is covered by test (f).
    await boot(page);
    await pinchAt(page, 'ui:continue');
    await pickFlight(page);
    await until('mode screen', async () => (await flow(page)) === 'modeSelect', 5000);
    await pinchAt(page, 'ui:auto');
    await until('practice', async () => (await flow(page)) === 'practice', 5000);
    await pinchAt(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await until('briefing', async () => (await flow(page)) === 'briefing', 5000);
    await pinchAt(page, 'ui:begin');
    await until('running', async () => (await flow(page)) === 'running', 5000);
    await page.waitForTimeout(600);
    await waitForTarget(page, 'card:twr-hold/hold-readback', 20_000);
    await pinchAt(page, 'card:twr-hold/hold-readback', { actions: 1, match: { kind: 'reply', messageId: 'twr-hold', cardId: 'hold-readback' } });
  });

  test('(f) a poke still registers after a pinch press on a button that disappears (T23)', async ({ page }) => {
    // Before T23, pinching a button that vanished on press (Continue, Auto, Begin, a reply card) left the SDK's ray
    // pointer holding a press that never ended, which locked that hand out of fingertip pokes for good.
    await boot(page);
    await pinchAt(page, 'ui:continue');
    await pickFlight(page);
    await until('mode screen', async () => (await flow(page)) === 'modeSelect', 5000);
    await poke(page, 'ui:auto'); // poke right after a pinch on a vanished button
    await until('practice', async () => (await flow(page)) === 'practice', 5000);
    await pinchAt(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await until('briefing', async () => (await flow(page)) === 'briefing', 5000);
    await pinchAt(page, 'ui:begin');
    await until('running', async () => (await flow(page)) === 'running', 5000);
    await page.waitForTimeout(600);
    await stepper(page, 'ap.hdg', 'plus', 2); // pokes on a cockpit control after two more pinch presses
    expect((await aircraft(page)).ap.hdg).toBe(20);
    await waitForTarget(page, 'card:twr-hold/hold-readback', 20_000);
    await pinchAt(page, 'card:twr-hold/hold-readback', { actions: 1, match: { kind: 'reply', messageId: 'twr-hold', cardId: 'hold-readback' } });
    await stepper(page, 'ap.hdg', 'minus', 1); // and again after a pinch on a reply card, which also disappears
    expect((await aircraft(page)).ap.hdg).toBe(10);
  });

  test('(c) climb mode WITHOUT the autopilot engaged does not gain altitude (T19)', async ({ page }) => {
    await boot(page);
    await toRunning(page);
    await es1(page);
    await reply(page, 'twr-takeoff', 'to-readback');
    await reply(page, 'dep-climb', 'dev-left');
    await stepper(page, 'ap.alt', 'plus', 8);
    await poke(page, 'ctl:ap.vertical#climb', { actions: 1, match: { kind: 'control', controlId: 'ap.vertical', value: 'climb' } }); // CLB selected, autopilot deliberately NOT engaged
    await page.waitForTimeout(1500);
    const a0 = await aircraft(page);
    expect(a0.ap.engaged).toBe(false);
    expect(a0.ap.vertical).toBe('climb');
    expect(a0.altitudeFt).toBeGreaterThan(0); // the takeoff really happened (aircraft is airborne at its takeoff altitude)
    await page.waitForTimeout(12_000); // 12 s real time = 72 scenario seconds
    const a1 = await aircraft(page);
    expect(a1.ap.engaged).toBe(false);
    expect(a1.altitudeFt).toBeLessThanOrEqual(a0.altitudeFt);
    expect((await snapshot(page)).flow).toBe('running');
  });
});
