/**
 * T41 flight picker and run-time scenario swap, driven ONLY by emulated hand input in the IWER desktop emulator.
 *
 * The real registry holds three flights (T44), so the picker is exercised with them; the second flight in test 1 is Cross-Check.
 * The dev-only `?flights=2` extra flight is no longer used here (it would be a fourth card; the picker shows three). The dev-only
 * `?flight=&variation=` pin does not exist in a production build.
 *
 *  1. A flight finished by hand, RESTART, the picker, the other flight: its briefing, checklists and route are on the panels, and
 *     nothing of the first flight (messages, ticks, printouts, alerts) is left.
 *  2. PRACTISE ALONE draws another variation of the same flight, never the one flown last, and the panels show it.
 *
 * Input purity: every user action is a poke (helpers/hands.ts). `page.evaluate` only READS the dev hooks.
 * EMULATOR evidence only: this says nothing about how the cards read or feel in a real headset.
 */
import { expect, test, type Page } from '@playwright/test';
import { FLIGHTS } from '../src/scenarios/registry';
import type { Scenario } from '../src/contracts/scenario';
import { enterXR, poke, targetPos, waitForTarget } from './helpers/hands';

interface Guide {
  stepId: string;
  pads: string[];
}
interface Content {
  briefing: { id: string; title: string; body: string }[];
  checklists: string[];
  openChecklist: string | null;
  ticked: string[];
  route: string[];
  messages: string[];
  alerts: string[];
}
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const flow = (page: Page) => read<string>(page, 't.flow()');
const guide = (page: Page) => read<Guide | null>(page, 't.guide()');
const flightNow = (page: Page) => read<{ id: string; variation: number }>(page, 't.flight()');
const content = (page: Page) => read<Content>(page, 't.panelContent()');
const rows = (page: Page) => read<{ eventSetId: string; grade: number }[]>(page, 't.session().debrief');
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/flights-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const inFlow = (page: Page, want: string, ms = 8000) => until(`flow ${want}`, async () => (await flow(page)) === want, ms);

/** What the panels must hold for `s`: the kneeboard briefing, the checklist titles and the route names. */
const expectedContent = (s: Scenario) => ({
  briefing: s.briefing.map((b) => ({ id: b.id, title: b.title, body: b.body })),
  checklists: s.checklists.map((c) => c.title),
  route: s.airports.map((a) => a.name),
});
/** Every pilot-visible message text of a scenario (start cues and rule cues). */
function messageTexts(s: Scenario): Set<string> {
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (r.kind === 'message' && typeof r.text === 'string' && r.channel !== 'crew') out.add(r.text);
      Object.values(r).forEach(walk);
    }
  };
  walk(s.eventSets);
  walk(s.softTimeout);
  return out;
}

const isPager = (pad: string) => /^pad:(check\.(next|prev)|comms\.page\.\d+)$/.test(pad);

/** Follow the guided flight's lit pads to the debrief, poking only what is framed (the first option at a decision). */
async function flyGuided(page: Page): Promise<void> {
  const startedAt = Date.now();
  while ((await flow(page)) === 'running') {
    if (Date.now() - startedAt > 9 * 60_000) throw new Error('guided flight not finished by hand in 9 min');
    const g = await guide(page);
    if (!g || g.pads.length === 0) {
      await page.waitForTimeout(250);
      continue;
    }
    const framed = g.pads[0];
    const changed = async () => {
      const now = await guide(page);
      return !now || now.stepId !== g.stepId || now.pads[0] !== framed;
    };
    if (isPager(framed)) {
      await poke(page, 'guide:0', { actions: 0, settleMs: 900, until: changed });
      await until(`the frame to leave ${framed}`, changed, 5000);
    } else {
      await poke(page, 'guide:0', { attempts: 3, approach: framed === 'pad:alerts.ack' ? 'straight' : 'normal', until: changed });
    }
    await page.waitForTimeout(300);
  }
}

async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => typeof (window as unknown as { __trainer?: { coldStartMs?: () => number | undefined } }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
  await enterXR(page);
  expect(await flow(page)).toBe('welcome');
}

test.describe('flight picker and scenario swap in IWER', () => {
  test('a finished flight, RESTART, another flight: its content is shown and nothing of the first remains', async ({ page }) => {
    // T44: three real flights are registered, so the second flight is a real one (Cross-Check, the newest) and no dev extra flight
    // is added (the picker shows at most three cards).
    const otherFlight = FLIGHTS.find((f) => f.id === 'cross-check');
    if (!otherFlight) throw new Error('cross-check is not registered');
    const second = otherFlight.build(0);
    const baseline = FLIGHTS[0].build(0);
    expect(FLIGHTS.length, 'the picker shows every registered flight').toBeLessThanOrEqual(3);
    expect(expectedContent(second).checklists, 'the second flight must differ from the baseline in its checklists').not.toEqual(expectedContent(baseline).checklists);

    await boot(page, '/?flight=single-source&variation=0');
    expect(await flightNow(page)).toEqual({ id: 'single-source', variation: 0 });

    // The picker: one card per registered flight, then the mode screen of the chosen flight (single-source has a guide).
    await poke(page, 'ui:continue');
    await inFlow(page, 'flightSelect');
    for (const f of FLIGHTS) await waitForTarget(page, `ui:flight:${f.id}`);
    expect(await targetPos(page, 'ui:flight:nope')).toBeNull();
    await page.waitForTimeout(700);
    await shot(page, 'picker');
    await poke(page, 'ui:flight:single-source');
    await inFlow(page, 'modeSelect');
    await waitForTarget(page, 'ui:guided');
    await waitForTarget(page, 'ui:auto');
    await page.waitForTimeout(600);
    await poke(page, 'ui:guided');
    await inFlow(page, 'practice');
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await inFlow(page, 'briefing');
    expect(await flightNow(page)).toEqual({ id: 'single-source', variation: 0 });
    expect(await content(page)).toMatchObject(expectedContent(baseline));
    await poke(page, 'ui:begin');
    await inFlow(page, 'running');
    await page.waitForTimeout(600);

    await flyGuided(page);
    expect(await flow(page)).toBe('debrief');
    expect((await rows(page)).map((r) => `${r.eventSetId}:${r.grade}`)).toEqual(baseline.eventSets.map((e) => `${e.id}:4`));
    const left = await content(page);
    expect(left.messages.length, 'the first flight left messages on the panels').toBeGreaterThan(0);
    expect(left.ticked.length, 'and a ticked checklist').toBeGreaterThan(0);
    await page.waitForTimeout(700);

    // RESTART goes to the picker; the other flight has no guide.
    await poke(page, 'ui:restart');
    await inFlow(page, 'flightSelect');
    await waitForTarget(page, 'ui:flight:cross-check');
    await page.waitForTimeout(600);
    await poke(page, 'ui:flight:cross-check');
    await inFlow(page, 'modeSelect');
    await waitForTarget(page, 'ui:auto');
    expect(await targetPos(page, 'ui:guided'), 'GUIDED FLIGHT is not offered for a flight without a guide').toBeNull();
    await page.waitForTimeout(600);
    await shot(page, 'mode-no-guide');
    await poke(page, 'ui:auto');
    await inFlow(page, 'briefing'); // the practice step was done in this page session

    // The second flight is on the panels, and nothing of the first is.
    expect(await flightNow(page)).toEqual({ id: 'cross-check', variation: 0 });
    const c = await content(page);
    expect(c).toMatchObject(expectedContent(second));
    expect(c.checklists).not.toEqual(expectedContent(baseline).checklists);
    expect(c.openChecklist).toBeNull();
    expect(c.ticked).toEqual([]);
    expect(c.messages).toEqual([]);
    expect(c.alerts).toEqual([]);
    expect(c.briefing.map((b) => b.id)).toEqual(second.briefing.map((b) => b.id)); // no printout of the first flight

    // Flying it: every message is the second flight's own.
    await poke(page, 'ui:begin');
    await inFlow(page, 'running');
    await until('the first message', async () => (await content(page)).messages.length > 0, 20_000);
    const own = messageTexts(second);
    for (const m of (await content(page)).messages) expect(own.has(m), `message "${m}" belongs to the second flight`).toBe(true);
  });

  test('PRACTISE ALONE draws another variation than the one flown last, and the panels show it', async ({ page }) => {
    // The last flight flown was variation 0: the draw must pick one of the other eleven.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('trainer.lastVariation.single-source', '0');
      } catch {
        /* storage unavailable: the test below then fails loudly */
      }
    });
    await boot(page, '/?flight=single-source');
    expect(await flightNow(page)).toEqual({ id: 'single-source', variation: 0 });
    await poke(page, 'ui:continue');
    await inFlow(page, 'flightSelect');
    await waitForTarget(page, 'ui:flight:single-source');
    await page.waitForTimeout(600);
    await poke(page, 'ui:flight:single-source');
    await inFlow(page, 'modeSelect');
    await page.waitForTimeout(600);
    await poke(page, 'ui:auto');
    await inFlow(page, 'practice');
    const { id, variation } = await flightNow(page);
    expect(id).toBe('single-source');
    expect(variation).toBeGreaterThanOrEqual(1);
    expect(variation).toBeLessThan(FLIGHTS[0].variations);
    expect(await page.evaluate(() => localStorage.getItem('trainer.lastVariation.single-source'))).toBe(String(variation));
    const expected = FLIGHTS[0].build(variation);
    expect(await content(page)).toMatchObject(expectedContent(expected));
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await inFlow(page, 'briefing');
    await poke(page, 'ui:begin');
    await inFlow(page, 'running');
    await until('the first message', async () => (await content(page)).messages.length > 0, 20_000);
    const own = messageTexts(expected);
    for (const m of (await content(page)).messages) expect(own.has(m), `message "${m}" belongs to variation ${variation}`).toBe(true);
  });
});
