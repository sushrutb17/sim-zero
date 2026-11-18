/** T50: hand pokes only; dev hooks only read state. IWER emulator evidence, not real Quest verification. */
import { expect, test, type Page } from '@playwright/test';
import { BASELINE_URL, enterXR, pickFlight, poke } from './helpers/hands';

interface Guide { stepId: string; pads: string[] }
const read = <T>(page: Page, body: string) => page.evaluate(`(() => { const t = window.__trainer; return ${body}; })()`) as Promise<T>;
const guide = (page: Page) => read<Guide | null>(page, 't.guide()');
const ticked = (page: Page) => read<boolean>(page, "t.checklistItemTicked('bt-altimeter')");
const flow = (page: Page) => read<string>(page, 't.flow()');
const set = (page: Page) => read<string | null>(page, 't.session().status.eventSetId');
const isPager = (pad: string) => /^pad:(check\.(next|prev)|comms\.page\.\d+)$/.test(pad);

async function followOne(page: Page): Promise<void> {
  const g = await guide(page);
  if (!g?.pads.length) {
    await page.waitForTimeout(250);
    return;
  }
  const changed = async () => {
    const next = await guide(page);
    return !next || next.stepId !== g.stepId || next.pads[0] !== g.pads[0];
  };
  await poke(page, 'guide:0', { ...(isPager(g.pads[0]) ? { actions: 0 } : { attempts: 3 }), until: changed });
  await page.waitForTimeout(300);
}

async function followUntil(page: Page, done: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 120_000;
  while (!(await done())) {
    if (Date.now() > end) throw new Error(`guide did not reach target: ${JSON.stringify(await guide(page))}`);
    expect(await flow(page)).toBe('running');
    await followOne(page);
  }
}

test('a guided checklist row ticks, unticks without an action, re-ticks and continues to the next event set', async ({ page }) => {
  await page.goto(BASELINE_URL);
  await page.waitForFunction('typeof window.__trainer?.coldStartMs?.() === "number"', null, { timeout: 90_000 });
  await enterXR(page);
  await poke(page, 'ui:continue');
  await pickFlight(page);
  await poke(page, 'ui:guided');
  await expect.poll(() => flow(page)).toBe('practice');
  await poke(page, 'ctl:practice.toggle', { actions: 1, match: { kind: 'control', controlId: 'practice.toggle', value: true } });
  await expect.poll(() => flow(page)).toBe('briefing');
  await poke(page, 'ui:begin');
  await expect.poll(() => flow(page)).toBe('running');
  await page.waitForTimeout(600);
  await followUntil(page, async () => (await guide(page))?.stepId === 'g1-c1');

  const target = 'check:beforeTakeoff:bt-altimeter';
  const action = { kind: 'checklistItem', checklistId: 'beforeTakeoff', itemId: 'bt-altimeter' };
  expect(await ticked(page)).toBe(false);
  await poke(page, target, { actions: 1, match: action });
  await expect.poll(() => ticked(page)).toBe(true);
  await expect.poll(async () => (await guide(page))?.stepId).toBe('g1-c2');
  const afterFirst = await guide(page);

  // Undo the item just requested. The satisfied guide step stays done; its frame stays on line 2.
  await poke(page, target, { actions: 0, until: async () => !(await ticked(page)) });
  expect(await ticked(page)).toBe(false);
  expect(await read<string[]>(page, 't.panelContent().ticked')).not.toContain('bt-altimeter');
  expect(await guide(page)).toEqual(afterFirst);
  await poke(page, target, { actions: 1, match: action });
  expect(await ticked(page)).toBe(true);
  expect(await guide(page)).toEqual(afterFirst);

  await followUntil(page, async () => (await guide(page))?.stepId === 'g1-c3');
  const later = await guide(page);
  await poke(page, target, { actions: 0, until: async () => !(await ticked(page)) });
  expect(await ticked(page)).toBe(false);
  expect(await guide(page)).toEqual(later); // a later step also keeps its own frame
  await poke(page, target, { actions: 1, match: action });
  expect(await ticked(page)).toBe(true);
  expect(await read<number>(page, `t.engineActions().filter(a => a.kind === 'checklistItem' && a.itemId === 'bt-altimeter').length`)).toBe(3);

  await followUntil(page, async () => (await set(page)) === 'es2-takeoff-climb');
  expect(await flow(page)).toBe('running');
  expect(await read<string>(page, 't.session().status.run')).toBe('running');
  await expect.poll(async () => (await guide(page))?.stepId).toBe('g2-takeoff');
  // Grade and timeline duplicate safety are covered by the unit integration tests: reviews exist only at flight end.
});
