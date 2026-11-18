/**
 * T45 Step 3a: the second flight, "Time Critical", flown from the flight picker to the debrief by hand on its best path,
 * in the IWER desktop emulator. Before this it was covered only by headless engine tests
 * (tests/scenarios/time-critical.test.ts); this proves it is completable through the real panels.
 *
 * Input purity: every user action is a poke (helpers/hands.ts). `page.evaluate` only READS the dev hooks. No `?flight=`
 * override: the page boots at `/` and the flight is chosen on the picker.
 *
 * EMULATOR evidence only: this says nothing about real hand-tracking quality or Quest performance.
 */
import { expect, test, type Page, type Response } from '@playwright/test';
import { timeCritical } from '../src/scenarios/time-critical';
import { enterXR, pickFlight, poke, pokeOnPage, stepper, targetPos, waitForTarget } from './helpers/hands';

const T0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s] ${m}`);

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
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const flow = (page: Page) => read<string>(page, 't.flow()');
const flightNow = (page: Page) => read<{ id: string; variation: number }>(page, 't.flight()');
const content = (page: Page) => read<Content>(page, 't.panelContent()');
const aircraft = (page: Page) => read<{ ap: { hdg: number }; destination: string; altitudeFt: number; headingDeg: number }>(page, 't.aircraft()');
const eventSet = (page: Page) => read<string>(page, 't.session().status.eventSetId ?? ""');
const status = (page: Page) => read<{ run: string; endReason?: string }>(page, 't.session().status');
const debrief = (page: Page) => read<Row[]>(page, 't.session().debrief');
const flyingDrawCalls = (page: Page) => read<{ max: number; samples: number }>(page, 't.flyingDrawCalls()');
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/time-critical-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const inFlow = (page: Page, want: string, ms = 8000) => until(`flow ${want}`, async () => (await flow(page)) === want, ms);
const inEventSet = (page: Page, id: string, ms?: number) => until(`event set ${id}`, async () => (await eventSet(page)) === id, ms);

// ---- boot --------------------------------------------------------------------------------------------------------

/** Voice clips that answered 200, by pathname. Collected from the first request on. */
async function boot(page: Page): Promise<{ clips: Map<string, number> }> {
  const clips = new Map<string, number>();
  page.on('response', (r: Response) => {
    const path = new URL(r.url()).pathname;
    if (/^\/audio\/voice\/[A-Za-z0-9_-]+\.mp3$/.test(path)) clips.set(path, r.status());
  });
  await page.goto('/'); // no flight override: the picker is the only way to the second flight
  await page.waitForFunction(() => typeof (window as unknown as { __trainer?: { coldStartMs?: () => number | undefined } }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
  await enterXR(page);
  expect(await flow(page)).toBe('welcome');
  return { clips };
}

// ---- the flight by hand ------------------------------------------------------------------------------------------

/**
 * A reply card. The comms panel has one page per unanswered message (tabs ATC / CABIN / DISPATCH ..., plus RECENT) and shows
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
/** Step the autopilot heading selector (10 degrees per press) from its current value to `to`. */
const setHeading = async (page: Page, to: number) => {
  const from = (await aircraft(page)).ap.hdg;
  const steps = Math.round((((to - from) % 360) + 540) % 360) - 180; // signed shortest turn, degrees
  log(`heading ${from} -> ${to} (${steps / 10} steps)`);
  expect(Math.abs(steps) % 10, 'heading selector moves in 10 degree steps').toBe(0);
  await stepper(page, 'ap.hdg', steps >= 0 ? 'plus' : 'minus', Math.abs(steps) / 10);
  expect((await aircraft(page)).ap.hdg).toBe(to);
};

test.describe('Time Critical flown by hand in IWER', () => {
  test('picker to debrief on the best path, then RESTART back to the picker', async ({ page }) => {
    const { clips } = await boot(page);

    // 1. welcome -> picker with two real flights
    await poke(page, 'ui:continue');
    await inFlow(page, 'flightSelect');
    await waitForTarget(page, 'ui:flight:single-source');
    await waitForTarget(page, 'ui:flight:time-critical');
    await page.waitForTimeout(700);
    await shot(page, 'picker');
    await pickFlight(page, 'time-critical');

    // 2. mode screen: no guide for this flight
    await inFlow(page, 'modeSelect');
    await waitForTarget(page, 'ui:auto');
    expect(await targetPos(page, 'ui:guided'), 'GUIDED FLIGHT is not offered for Time Critical').toBeNull();
    await page.waitForTimeout(600);
    await shot(page, 'mode');
    await poke(page, 'ui:auto');
    await inFlow(page, 'practice');
    expect(await flightNow(page)).toEqual({ id: 'time-critical', variation: 0 });
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await inFlow(page, 'briefing');
    expect(await flightNow(page)).toEqual({ id: 'time-critical', variation: 0 });
    const c = await content(page);
    expect(c.briefing).toEqual(timeCritical.briefing.map((b) => ({ id: b.id, title: b.title, body: b.body })));
    expect(c.checklists).toEqual(['CRUISE', 'DIVERSION']);
    expect(c.checklists).toEqual(timeCritical.checklists.map((l) => l.title));
    expect(c.route).toEqual(timeCritical.airports.map((a) => a.name));
    await poke(page, 'ui:begin');
    await inFlow(page, 'running');
    await page.waitForTimeout(600);

    // 3. Event Set 1: cruise
    await inEventSet(page, 'tc-es1-cruise', 10_000);
    await reply(page, 'tc-frequency', 'tc-frequency-readback');
    let first = true;
    for (const id of ['tc-cr-autopilot', 'tc-cr-frequency', 'tc-cr-route']) {
      await checkItem(page, 'tc-cruise', id, first);
      first = false;
    }
    await inEventSet(page, 'tc-es2-cabin-call', 60_000);

    // 4. Event Set 2: traffic heading and the cabin conversation
    await reply(page, 'tc-traffic', 'tc-traffic-readback');
    await setHeading(page, 110);
    await reply(page, 'tc-cabin-collapse', 'tc-ask-condition');
    await reply(page, 'tc-condition-report', 'tc-ask-attending');
    await reply(page, 'tc-attending-report', 'tc-ask-doctor');
    await inEventSet(page, 'tc-es3-decision', 60_000);
    await shot(page, 'midflight');

    // 5. Event Set 3: decision and set-up (best airport)
    await reply(page, 'tc-intentions', 'tc-divert-large');
    await poke(page, 'route:tc-large', { actions: 1, match: { kind: 'control', controlId: 'route.destination', value: 'tc-large' } });
    expect((await aircraft(page)).destination).toBe('tc-large');
    await setHeading(page, 70);
    await reply(page, 'tc-dispatch-large', 'tc-dispatch-informed');
    first = true;
    for (const id of ['tc-dv-condition', 'tc-dv-clearance', 'tc-dv-dispatch', 'tc-dv-cabin']) {
      await checkItem(page, 'tc-diversion', id, first);
      first = false;
    }
    await poke(page, 'pa', { actions: 1, match: { kind: 'control', controlId: 'pa.cabin', value: true } });
    await reply(page, 'tc-cabin-brief', 'tc-cabin-clear');

    // 6. debrief
    await until('debrief', async () => (await flow(page)) === 'debrief', 30_000);
    await page.waitForTimeout(700);
    await shot(page, 'debrief');
    const rows = await debrief(page);
    expect(rows.map((r) => r.eventSetId)).toEqual(['tc-es1-cruise', 'tc-es2-cabin-call', 'tc-es3-decision']);
    expect(rows.map((r) => r.grade), `grades with reasons: ${JSON.stringify(rows.map((r) => [r.eventSetId, r.grade, r.reasons]))}`).toEqual([4, 4, 4]);
    expect(rows.some((r) => r.eventSetId.startsWith('es')), 'no Single Source row').toBe(false);
    const st = await status(page);
    console.log(`debrief rows: ${rows.map((r) => `${r.eventSetId}:${r.grade}`).join(', ')}; status ${JSON.stringify(st)}`);
    expect(st.endReason).toBe('diversionSetUp');
    const a = await aircraft(page);
    expect(a.destination).toBe('tc-large');
    expect(a.ap.hdg).toBe(70);

    // 7. budget
    const calls = await flyingDrawCalls(page);
    console.log(`Time Critical emulator flying draw calls: max ${calls.max}, samples ${calls.samples}`);
    expect(calls.samples).toBeGreaterThan(0);
    expect(calls.max).toBeGreaterThan(0);
    expect(calls.max).toBeLessThanOrEqual(150);

    // 8. voice: the Time Critical clips were fetched (they load in the background after the welcome screen)
    for (const p of ['/audio/voice/tc-cabin-collapse.mp3', '/audio/voice/tc-intentions.mp3']) {
      expect(clips.get(p), `voice clip ${p}`).toBe(200);
    }
    const tc = [...clips.keys()].filter((p) => p.includes('/tc-'));
    console.log(`voice clips seen: ${clips.size} total, ${tc.length} Time Critical (all 200: ${[...clips.values()].every((s) => s === 200)})`);

    // 9. RESTART: back to the picker; Single Source offers its guide again
    await poke(page, 'ui:restart');
    await inFlow(page, 'flightSelect');
    await waitForTarget(page, 'ui:flight:single-source');
    await page.waitForTimeout(600);
    await poke(page, 'ui:flight:single-source');
    await inFlow(page, 'modeSelect');
    await waitForTarget(page, 'ui:auto');
    await waitForTarget(page, 'ui:guided');
    // (the scenario itself is swapped when the MODE is chosen, not on the picker, so flight() still says time-critical here)
  });
});
