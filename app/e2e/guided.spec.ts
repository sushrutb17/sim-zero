/**
 * T24 guided flight, driven ONLY by emulated hand pokes in the IWER desktop emulator: choose GUIDED FLIGHT, then fly
 * the whole scenario by poking whatever pad the trainer has framed, and nothing else. At a decision (several pads
 * framed) the test takes the first option.
 *
 * Input purity: every user action is a poke (helpers/hands.ts). `page.evaluate` only READS the dev hooks.
 * EMULATOR evidence only: this says nothing about how the frames and the strip look or read in a real headset.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASELINE_URL, enterXR, pickFlight, poke, waitForTarget } from './helpers/hands';

interface Guide {
  stepId: string;
  waiting: boolean;
  text: string;
  pads: string[];
}
interface Aircraft {
  baroHpa: number;
  destination: string;
  ap: { hdg: number; alt: number };
  lights: { landing: boolean; strobe: boolean };
}
interface Row {
  eventSetId: string;
  grade: number;
  reasons?: { label: string; text: string }[];
}
interface Perf {
  fps: number;
  calls: number;
  triangles: number;
  textures: number;
  maxTextureSize: number;
}
type Trainer = { coldStartMs?(): number | undefined };
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const flow = (page: Page) => read<string>(page, 't.flow()');
const guide = (page: Page) => read<Guide | null>(page, 't.guide()');
const eventSet = (page: Page) => read<string | null>(page, 't.session().status.eventSetId');
const aircraft = (page: Page) => read<Aircraft>(page, 't.aircraft()');
const debrief = (page: Page) => read<Row[]>(page, 't.session().debrief');
const perf = (page: Page) => read<Perf>(page, 't.perf()');
const drawCalls = (page: Page) => read<number>(page, 't.drawCalls()');
const crewCaption = (page: Page) => read<{ head: string; body: string } | null>(page, 't.crewCaption()');
const rawCrewCaption = (page: Page) => read<string | null>(page, 't.rawCrewCaption()');
const flyingDrawCalls = (page: Page) => read<{ max: number; samples: number }>(page, 't.flyingDrawCalls()');
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/guided-${name}.png` });

async function until(what: string, pred: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Pads that turn a page: pressing one emits no pilot action, it only changes what is framed next. */
const isPager = (pad: string) => /^pad:(check\.(next|prev)|comms\.page\.\d+)$/.test(pad);
/** XR draw-call budget while flying (both eyes counted), from the design. */
const DRAW_CALL_LIMIT = 150;
/** Global performance budget (plan): triangles per frame and texture side in pixels. */
const TRIANGLE_LIMIT = 150_000;
const TEXTURE_LIMIT = 2048;

test.describe('guided flight in IWER', () => {
  test('a whole guided flight by poking only framed pads, then RESTART into an unguided flight', async ({ page }) => {
    await page.goto(BASELINE_URL);
    await page.waitForFunction(() => typeof (window as unknown as { __trainer?: Trainer }).__trainer?.coldStartMs?.() === 'number', null, { timeout: 90_000 });
    await enterXR(page);

    // No guidance on any trainer screen.
    expect(await flow(page)).toBe('welcome');
    expect(await guide(page)).toBeNull();
    await poke(page, 'ui:continue');
    await pickFlight(page);
    await until('mode screen', async () => (await flow(page)) === 'modeSelect', 5000);
    expect(await guide(page)).toBeNull();
    await waitForTarget(page, 'ui:guided');
    await shot(page, 'mode-screen');
    await poke(page, 'ui:guided');
    await until('practice', async () => (await flow(page)) === 'practice', 5000);
    expect(await guide(page)).toBeNull();
    await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
    await until('briefing', async () => (await flow(page)) === 'briefing', 5000);
    expect(await guide(page)).toBeNull();
    await poke(page, 'ui:begin');
    await until('running', async () => (await flow(page)) === 'running', 5000);
    const startedAt = Date.now();
    await page.waitForTimeout(600); // past the 0.35 s engage grace

    // Follow the lights to the debrief.
    const stepsPoked: string[] = [];
    const decisions: { stepId: string; options: number }[] = [];
    const setStart: Record<string, number> = {};
    let pokes = 0;
    let maxDrawCalls = 0;
    let decisionDrawCalls = 0;
    // Per Event Set maxima (calls/triangles) and the fps range seen; emulator numbers, not a device frame rate.
    const perSet: Record<string, { calls: number; triangles: number; minFps: number; maxFps: number; samples: number }> = {};
    let maxTextureSize = 0;
    let maxTextures = 0;
    const samplePerf = async () => {
      const set = (await eventSet(page)) ?? 'none';
      const p = await perf(page);
      const e = (perSet[set] ??= { calls: 0, triangles: 0, minFps: Infinity, maxFps: 0, samples: 0 });
      e.calls = Math.max(e.calls, p.calls);
      e.triangles = Math.max(e.triangles, p.triangles);
      if (p.fps > 0) {
        e.minFps = Math.min(e.minFps, p.fps);
        e.maxFps = Math.max(e.maxFps, p.fps);
      }
      e.samples++;
      maxTextureSize = Math.max(maxTextureSize, p.maxTextureSize);
      maxTextures = Math.max(maxTextures, p.textures);
    };
    while ((await flow(page)) === 'running') {
      if (Date.now() - startedAt > 9 * 60_000) throw new Error(`guided flight not finished by hand in 9 min (steps so far: ${stepsPoked.join(', ')})`);
      const set = await eventSet(page);
      if (set && setStart[set] === undefined) setStart[set] = Date.now();
      await samplePerf();
      const g = await guide(page);
      if (!g || g.pads.length === 0) {
        await page.waitForTimeout(250);
        continue;
      }
      const first = stepsPoked[stepsPoked.length - 1] !== g.stepId;
      if (first) stepsPoked.push(g.stepId);
      const calls = await drawCalls(page);
      maxDrawCalls = Math.max(maxDrawCalls, calls);
      if (g.pads.length > 1 && first) {
        decisions.push({ stepId: g.stepId, options: g.pads.length });
        if (g.stepId === 'g4-decide') {
          decisionDrawCalls = calls;
          await shot(page, 'decision');
        }
      }
      if (g.stepId === 'g1-baro' && first) await shot(page, 'step-baro');
      if (g.stepId === 'g3-gen1' && first) await shot(page, 'step-overhead');
      const framed = g.pads[0];
      const changed = async () => {
        const now = await guide(page);
        return !now || now.stepId !== g.stepId || now.pads[0] !== framed;
      };
      if (isPager(framed)) {
        await poke(page, 'guide:0', { actions: 0, settleMs: 900, until: changed });
        await until(`the frame to leave ${framed}`, changed, 5000);
      } else {
        // attempts 3: a guarded switch takes one press to lift its guard (no action) and one to throw it
        await poke(page, 'guide:0', { attempts: 3, approach: framed === 'pad:alerts.ack' ? 'straight' : 'normal', until: changed });
      }
      if (g.stepId === 'g2-ap') {
        await expect.poll(async () => (await guide(page))?.stepId).toBe('g2-clb');
        await expect.poll(() => crewCaption(page)).toMatchObject({ body: 'Press CLB so the aircraft climbs.' });
        expect(await rawCrewCaption(page)).toBe('Autopilot engaged.');
        expect((await crewCaption(page))?.head).not.toBe('FIRST OFFICER');
      }
      pokes++;
      await page.waitForTimeout(300); // the guide refreshes about five times a second
    }
    const elapsedSec = (Date.now() - startedAt) / 1000;
    console.log(`guided flight: ${pokes} pokes in ${elapsedSec.toFixed(0)} s; max draw calls ${maxDrawCalls}, at the 4-option decision ${decisionDrawCalls}`);
    console.log(`steps: ${stepsPoked.join(' > ')}`);
    for (const [set, e] of Object.entries(perSet)) {
      console.log(`perf ${set}: max calls ${e.calls}, max triangles ${e.triangles}, fps ${e.minFps === Infinity ? 'n/a' : e.minFps.toFixed(1)}..${e.maxFps.toFixed(1)} (emulator), ${e.samples} samples`);
    }
    console.log(`perf textures: ${maxTextures} in scene, max texture size ${maxTextureSize}px`);

    // Every step of the path taken was shown and done, in order (first option at each decision: left, return).
    expect(stepsPoked).toEqual([
      'g1-hold', 'g1-baro', 'g1-hdg', 'g1-alt', 'g1-land', 'g1-strobe', 'g1-c1', 'g1-c2', 'g1-c3', 'g1-c4', 'g1-c5',
      'g2-takeoff', 'g2-ap', 'g2-clb', 'g2-deviate', 'g2-alt', 'g2-hdg-left',
      'g3-handoff', 'g3-ack', 'g3-c1', 'g3-gen1', 'g3-c2', 'g3-bustie', 'g3-c3', 'g3-cabin', 'g3-c4', 'g3-center', 'g3-c5',
      'g4-decide', 'g4-route-return', 'g4-pa', 'g4-announce',
    ]);
    expect(decisions).toEqual([
      { stepId: 'g2-deviate', options: 2 },
      { stepId: 'g4-decide', options: 4 },
    ]);
    const flyingCalls = await flyingDrawCalls(page);
    console.log(`guided XR flying draw calls: max ${flyingCalls.max}, samples ${flyingCalls.samples}`);
    expect(flyingCalls.samples).toBeGreaterThan(0);
    expect(flyingCalls.max).toBeGreaterThan(0);
    expect(flyingCalls.max).toBeLessThanOrEqual(DRAW_CALL_LIMIT);
    expect(decisionDrawCalls).toBeGreaterThan(0);
    expect(maxDrawCalls).toBeLessThanOrEqual(DRAW_CALL_LIMIT);
    // Performance budget, per Event Set (ES3 included) and overall.
    expect(Object.keys(perSet).some((k) => k.startsWith('es3'))).toBe(true);
    for (const [set, e] of Object.entries(perSet)) {
      expect(e.calls, `${set} draw calls`).toBeLessThanOrEqual(DRAW_CALL_LIMIT);
      expect(e.triangles, `${set} triangles`).toBeLessThanOrEqual(TRIANGLE_LIMIT);
    }
    expect(maxTextureSize).toBeGreaterThan(0);
    expect(maxTextureSize).toBeLessThanOrEqual(TEXTURE_LIMIT);

    // Debrief: reached by finishing, with full marks, and no guidance on it.
    expect(await flow(page)).toBe('debrief');
    expect(await crewCaption(page)).toBeNull();
    expect((await aircraft(page)).destination).toBe('dep');
    const rows = await debrief(page);
    expect(rows.map((r) => `${r.eventSetId}:${r.grade}`), JSON.stringify(rows.map((r) => r.reasons))).toEqual([
      'es1-before-takeoff:4',
      'es2-takeoff-climb:4',
      'es3-gen-failure:4',
      'es4-decision:4',
    ]);
    expect(await guide(page)).toBeNull();
    await page.waitForTimeout(700);
    await shot(page, 'debrief');

    // RESTART goes to the mode screen; PRACTISE ALONE then flies with no practice step and no guidance.
    await poke(page, 'ui:restart');
    await pickFlight(page);
    await until('mode screen after restart', async () => (await flow(page)) === 'modeSelect', 5000);
    await page.waitForTimeout(600);
    await poke(page, 'ui:auto');
    await until('briefing, practice skipped', async () => (await flow(page)) === 'briefing', 5000);
    await page.waitForTimeout(600);
    await poke(page, 'ui:begin');
    await until('running again', async () => (await flow(page)) === 'running', 5000);
    await page.waitForTimeout(1500);
    expect(await guide(page)).toBeNull();
    await shot(page, 'unguided');
  });
});
