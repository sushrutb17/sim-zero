/**
 * T44 Step 7: the third flight, "Cross-Check", flown from the three-card flight picker to the debrief by hand on its best path,
 * in the IWER desktop emulator. Before this it was covered only by headless engine tests (tests/scenarios/cross-check.test.ts);
 * this proves it is completable through the real panels, including the Event Set 3 level-off, which is a race against a
 * climb of 125 ft per second (250 before the timeCompression change).
 *
 * Input purity: every user action is a poke (helpers/hands.ts). `page.evaluate` only READS the dev hooks. No `?flight=`
 * override: the page boots at `/` and the flight is chosen on the picker.
 *
 * EMULATOR evidence only: this says nothing about real hand-tracking quality or Quest performance. How long the emulated
 * presses take says nothing about how long a person's presses take in a headset.
 */
import { expect, test, type Page, type Response } from '@playwright/test';
import { crossCheck } from '../src/scenarios/cross-check';
import { enterXR, pickFlight, poke, pokeOnPage, stepper, targetPos, waitForTarget } from './helpers/hands';

const T0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${m}`);

// ---- read-only probes -------------------------------------------------------------------------------------------

interface Row {
  eventSetId: string;
  grade: number;
  reasons?: { label: string; text: string }[];
}
interface Content {
  briefing: { id: string; title: string; body: string }[];
  checklists: string[];
  route: string[];
}
interface Aircraft {
  ap: { engaged: boolean; hdg: number; alt: number; vertical: string };
  baroHpa: number;
  destination: string;
  altitudeFt: number;
  headingDeg: number;
}
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const flow = (page: Page) => read<string>(page, 't.flow()');
const flightNow = (page: Page) => read<{ id: string; variation: number }>(page, 't.flight()');
const content = (page: Page) => read<Content>(page, 't.panelContent()');
const aircraft = (page: Page) => read<Aircraft>(page, 't.aircraft()');
const eventSet = (page: Page) => read<string>(page, 't.session().status.eventSetId ?? ""');
const status = (page: Page) => read<{ run: string; endReason?: string }>(page, 't.session().status');
const debrief = (page: Page) => read<Row[]>(page, 't.session().debrief');
const flyingDrawCalls = (page: Page) => read<{ max: number; samples: number }>(page, 't.flyingDrawCalls()');
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/cross-check-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const inFlow = (page: Page, want: string, ms = 8000) => until(`flow ${want}`, async () => (await flow(page)) === want, ms);
const inEventSet = (page: Page, id: string, ms?: number) => until(`event set ${id}`, async () => (await eventSet(page)) === id, ms);

/** Highest altitude seen by polling the read-only dev hook (about every 100 ms) between start() and stop(). */
function altitudeWatch(page: Page): { start(): void; stop(): number } {
  let on = false;
  let max = 0;
  const loop = async () => {
    while (on) {
      try {
        max = Math.max(max, (await aircraft(page)).altitudeFt);
      } catch {
        /* page closing */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  return {
    start: () => {
      on = true;
      void loop();
    },
    stop: () => {
      on = false;
      return max;
    },
  };
}

// ---- boot --------------------------------------------------------------------------------------------------------

/** Voice clips by pathname and status. Collected from the first request on. */
async function boot(page: Page): Promise<{ clips: Map<string, number> }> {
  const clips = new Map<string, number>();
  page.on('response', (r: Response) => {
    const path = new URL(r.url()).pathname;
    if (/^\/audio\/voice\/[A-Za-z0-9_-]+\.mp3$/.test(path)) clips.set(path, r.status());
  });
  await page.goto('/'); // no flight override: the picker is the only way to the third flight
  await page.waitForFunction(() => typeof (window as unknown as { __trainer?: { coldStartMs?: () => number | undefined } }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
  await enterXR(page);
  expect(await flow(page)).toBe('welcome');
  return { clips };
}

// ---- the flight by hand ------------------------------------------------------------------------------------------

/**
 * A reply card. The comms panel has one page per unanswered message (tabs ATC / CABIN / ..., plus RECENT) and shows
 * the newest, so the card may sit on another tab: its page pad is `page:<messageId>`, poked until the card shows.
 */
const reply = async (page: Page, messageId: string, cardId: string) => {
  log(`reply ${messageId}/${cardId}`);
  const id = `card:${messageId}/${cardId}`;
  try {
    await until(`message ${messageId} on the comms panel`, async () => (await targetPos(page, id)) !== null || (await targetPos(page, `page:${messageId}`)) !== null, 60_000);
  } catch (e) {
    const pc = await read<unknown>(page, 't.panelContent()');
    const ss = await read<unknown>(page, '({ status: t.session().status, flow: t.flow() })');
    console.log(`DIAG ${id}: ${JSON.stringify({ ss, pc })}`);
    await shot(page, 'diag');
    throw e;
  }
  await pokeOnPage(page, id, [`page:${messageId}`], { actions: 1, match: { kind: 'reply', messageId, cardId } });
};
const checkItem = async (page: Page, list: string, item: string, first = false) => {
  log(`check ${list}:${item}`);
  if (first) await waitForTarget(page, `check:${list}:${item}`, 60_000);
  await pokeOnPage(page, `check:${list}:${item}`, ['check:next', 'check:prev'], { actions: 1, match: { kind: 'checklistItem', checklistId: list, itemId: item } });
};
/** Is the message (its card, or its page pad on the comms panel) shown yet? */
const messageShown = async (page: Page, messageId: string, cardId: string) =>
  (await targetPos(page, `card:${messageId}/${cardId}`)) !== null || (await targetPos(page, `page:${messageId}`)) !== null;

/** Press a stepper `n` times from the value now to `to` (one press moves `unit`); assert the aircraft state afterwards. */
const stepAp = async (page: Page, controlId: 'ap.alt' | 'ap.hdg' | 'baro.set', read: (a: Aircraft) => number, unit: number, to: number) => {
  const from = read(await aircraft(page));
  const steps = Math.round((to - from) / unit);
  log(`${controlId} ${from} -> ${to} (${steps} presses)`);
  expect(steps * unit, `${controlId} moves in steps of ${unit}`).toBe(to - from);
  if (steps !== 0) await stepper(page, controlId, steps > 0 ? 'plus' : 'minus', Math.abs(steps));
  expect(read(await aircraft(page))).toBe(to);
};
const setAlt = (page: Page, to: number) => stepAp(page, 'ap.alt', (a) => a.ap.alt, 1000, to);
const setHdg = (page: Page, to: number) => stepAp(page, 'ap.hdg', (a) => a.ap.hdg, 10, to);
const setBaro = (page: Page, to: number) => stepAp(page, 'baro.set', (a) => a.baroHpa, 1, to);

test.describe('Cross-Check flown by hand in IWER', () => {
  test('picker to debrief on the best path, then RESTART back to the picker', async ({ page }) => {
    const { clips } = await boot(page);

    // 1. welcome -> picker with three real flights (the cards are narrow now: each must still be hit by a fingertip)
    await poke(page, 'ui:continue');
    await inFlow(page, 'flightSelect');
    for (const id of ['single-source', 'time-critical', 'cross-check']) await waitForTarget(page, `ui:flight:${id}`);
    await page.waitForTimeout(700);
    await shot(page, 'picker');
    await pickFlight(page, 'cross-check');

    // 2. mode screen: no guide for this flight
    await inFlow(page, 'modeSelect');
    await waitForTarget(page, 'ui:auto');
    expect(await targetPos(page, 'ui:guided'), 'GUIDED FLIGHT is not offered for Cross-Check').toBeNull();
    await page.waitForTimeout(600);
    await shot(page, 'mode');
    await poke(page, 'ui:auto');
    await inFlow(page, 'practice');
    expect(await flightNow(page)).toEqual({ id: 'cross-check', variation: 0 });
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await inFlow(page, 'briefing');
    const c = await content(page);
    expect(c.briefing).toEqual(crossCheck.briefing.map((b) => ({ id: b.id, title: b.title, body: b.body })));
    expect(c.checklists).toEqual(crossCheck.checklists.map((l) => l.title));
    expect(c.route).toEqual(crossCheck.airports.map((a) => a.name));
    const a0 = await aircraft(page);
    expect(a0.ap).toMatchObject({ engaged: false, hdg: 270, alt: 4000 });
    expect(a0.baroHpa).toBe(1011);
    await poke(page, 'ui:begin');
    await inFlow(page, 'running');
    await page.waitForTimeout(600);

    // 3. Event Set 1: the late change
    await inEventSet(page, 'cc-es1-late-change', 10_000);
    await reply(page, 'cc-twr-amend', 'cc-amend-readback');
    await setAlt(page, 5000);
    await setHdg(page, 240);
    await setBaro(page, 1008);
    let first = true;
    for (const id of ['cc-am-altitude', 'cc-am-heading', 'cc-am-altimeter', 'cc-am-brief']) {
      await checkItem(page, 'cc-amended', id, first);
      first = false;
    }
    await reply(page, 'cc-twr-ready', 'cc-ready-now'); // all three settings are right by now: no error trap
    await reply(page, 'cc-twr-takeoff', 'cc-takeoff-readback');
    const a1 = await aircraft(page);
    expect(a1.ap).toMatchObject({ alt: 5000, hdg: 240 });
    expect(a1.baroHpa).toBe(1008);

    // 4. Event Set 2: similar callsign
    await inEventSet(page, 'cc-es2-similar-callsign', 60_000);
    const watch = altitudeWatch(page);
    watch.start();
    await reply(page, 'cc-dep-contact', 'cc-dep-readback');
    await poke(page, 'ctl:ap.engage', { actions: 1, match: { kind: 'control', controlId: 'ap.engage', value: true } }); // the aircraft only climbs with the autopilot engaged in CLB
    await poke(page, 'ctl:ap.vertical#climb', { actions: 1, match: { kind: 'control', controlId: 'ap.vertical', value: 'climb' } });
    expect((await aircraft(page)).ap).toMatchObject({ engaged: true, vertical: 'climb' });
    await reply(page, 'cc-atc-417', 'cc-say-again'); // the call for the OTHER flight: ask, do not read back
    await until('the real clearance on the comms panel', () => messageShown(page, 'cc-atc-real', 'cc-real-readback'), 60_000);
    log(`real clearance shown at ${Math.round((await aircraft(page)).altitudeFt)} ft`);
    await setAlt(page, 14000); // never 16000
    await reply(page, 'cc-atc-real', 'cc-real-readback');
    log(`Event Set 2 answered at ${Math.round((await aircraft(page)).altitudeFt)} ft`);

    // 5. Event Set 3: the level-off race. ALTITUDE FIRST.
    await inEventSet(page, 'cc-es3-level-off', 30_000);
    await until('the stop call on the comms panel', () => messageShown(page, 'cc-atc-stop', 'cc-stop-readback'), 30_000);
    const tStop = Date.now();
    const altAtStop = (await aircraft(page)).altitudeFt;
    log(`stop call shown at ${Math.round(altAtStop)} ft, autopilot alt ${(await aircraft(page)).ap.alt}`);
    await setAlt(page, 11000);
    const altPressMs = Date.now() - tStop;
    const altAfterPresses = (await aircraft(page)).altitudeFt;
    log(`three ap.alt presses took ${(altPressMs / 1000).toFixed(1)} s (stop call shown -> 11000 set); aircraft at ${Math.round(altAfterPresses)} ft`);
    await reply(page, 'cc-atc-stop', 'cc-stop-readback');
    await setBaro(page, 1013);
    await reply(page, 'cc-cabin-galley', 'cc-cabin-standby');
    await reply(page, 'cc-cabin-callback', 'cc-callback-go'); // arrives 8 s after the standby

    // 6. debrief
    await until('debrief', async () => (await flow(page)) === 'debrief', 40_000);
    const maxAlt = watch.stop();
    log(`maximum altitude during Event Sets 2 and 3: ${Math.round(maxAlt)} ft`);
    await page.waitForTimeout(700);
    await shot(page, 'debrief');
    const rows = await debrief(page);
    expect(rows.map((r) => r.eventSetId)).toEqual(['cc-es1-late-change', 'cc-es2-similar-callsign', 'cc-es3-level-off']);
    expect(rows.map((r) => r.grade), `grades with reasons: ${JSON.stringify(rows.map((r) => [r.eventSetId, r.grade, r.reasons]))}`).toEqual([4, 4, 4]);
    expect(rows.some((r) => r.eventSetId.startsWith('es') || r.eventSetId.startsWith('tc-')), 'no other flight rows').toBe(false);
    const st = await status(page);
    console.log(`debrief rows: ${rows.map((r) => `${r.eventSetId}:${r.grade}`).join(', ')}; status ${JSON.stringify(st)}`);
    expect(st.endReason).toBe('completed');
    expect(maxAlt, 'never climbed 300 ft through 11,000 ft').toBeLessThan(11_300);
    const end = await aircraft(page);
    expect(end.ap.alt).toBe(11000);
    expect(end.baroHpa).toBe(1013);
    expect(Math.abs(end.altitudeFt - 11000)).toBeLessThanOrEqual(10);

    // 7. budget
    const calls = await flyingDrawCalls(page);
    console.log(`Cross-Check emulator flying draw calls: max ${calls.max}, samples ${calls.samples}`);
    expect(calls.samples).toBeGreaterThan(0);
    expect(calls.max).toBeGreaterThan(0);
    expect(calls.max).toBeLessThanOrEqual(150);

    // 8. voice: every Cross-Check clip was fetched (they load in the background after the welcome screen)
    const cc = [...clips.entries()].filter(([p]) => p.includes('/audio/voice/cc-'));
    console.log(`voice clips seen: ${clips.size} total, ${cc.length} Cross-Check (all 200: ${cc.every(([, s]) => s === 200)})`);
    expect(cc.length, 'all 20 Cross-Check voice clips requested').toBe(20);
    for (const [p, s] of cc) expect(s, `voice clip ${p}`).toBe(200);

    // 9. RESTART: back to the picker, which still shows three cards
    await poke(page, 'ui:restart');
    await inFlow(page, 'flightSelect');
    for (const id of ['single-source', 'time-critical', 'cross-check']) await waitForTarget(page, `ui:flight:${id}`);
  });
});
