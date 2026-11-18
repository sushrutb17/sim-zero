// "Follow the lights" (T24): a player that only ever does what the guided-flight tracker indicates must be able to fly
// the whole real scenario. Where the tracker offers more than one target it is the person's own decision: the test picks.
// The panel models and the alert list are fed from the session's cues exactly as the real panels and displays feed them.
import { describe, expect, it } from 'vitest';
import { play } from './guidePlayer';
import { inter } from '@pmndrs/msdfonts';
import singleSource from '../../src/scenarios/single-source';
import { wrapText } from '../../src/xr/panels/textLayout';
import { THEME, fontSizeForCap } from '../../src/xr/theme';

describe('guided flight: follow the lights (real single-source content)', () => {
  it('every Event Set has guide steps', () => {
    for (const es of singleSource.eventSets) expect(es.guide?.length ?? 0, es.id).toBeGreaterThan(0);
  });

  for (const dev of ['dev-left', 'dev-right'])
    for (const dec of ['dec-return', 'dec-divert-alt1'])
      it(`${dev} + ${dec}: reaches the end with grade 4 on all four Event Sets`, () => {
        const r = play({ decisions: { 'g2-deviate': dev, 'g4-decide': dec } });
        expect(r.reasons).toEqual([[], [], [], []]);
        expect(r.grades).toEqual([4, 4, 4, 4]);
        expect(r.endReason).toBe('diversionSetUp');
      });

  for (const [dev, direction, goal, earlyHeading, presses] of [
    ['dev-left', 'left', '060', 70, [80, 70]],
    ['dev-right', 'right', '120', 110, [100, 110]],
  ] as const)
    it(`${dev}: slow heading button presses advance when clear of the storm, before the exact target`, () => {
      const r = play({ decisions: { 'g2-deviate': dev, 'g4-decide': 'dec-return' }, stepClimbControls: true, pressIntervalSec: 2 });
      const headingStep = singleSource.eventSets.find((s) => s.id === 'es2-takeoff-climb')!.guide!.find((g) => g.id === `g2-hdg-${direction}`)!;
      expect(headingStep.text).toContain(`toward HDG ${goal}`);
      expect(headingStep.text).toContain('next step appears once clear of the storm');
      expect(r.headingPresses).toEqual(presses);
      const entry = r.es3Entry;
      expect(entry.ap.hdg).toBe(earlyHeading);
      expect(entry.headingDeg).toBe(earlyHeading);
      expect(entry.altitudeFt).toBeGreaterThanOrEqual(6000);
      expect(r.firstGuideBySet.get('es3-gen-failure')).toBe('g3-handoff');
      expect(r.reasons).toEqual([[], [], [], []]);
      expect(r.grades).toEqual([4, 4, 4, 4]);
      expect(r.endReason).toBe('diversionSetUp');
    });

  it('divert to the weakest alternate: still guided to the end', () => {
    const r = play({ decisions: { 'g2-deviate': 'dev-left', 'g4-decide': 'dec-divert-alt2' } });
    expect(r.endReason).toBe('diversionSetUp');
    expect(r.stepsShown).toContain('g4-route-alt2');
  });

  it('continue, then confirm: guided to the end', () => {
    const r = play({ decisions: { 'g2-deviate': 'dev-right', 'g4-decide': 'dec-continue', 'g4-confirm': 'confirm-continue' } });
    expect(r.endReason).toBe('continueConfirmed');
    expect(r.stepsShown).toContain('g4-confirm');
  });

  it('continue, reconsider, then return: guided to the end', () => {
    let reconsidered = false;
    const decisions: Record<string, string> = { 'g2-deviate': 'dev-left', 'g4-decide': 'dec-continue', 'g4-confirm': 'reconsider' };
    const r = play({
      decisions,
      offScript: (rig) => {
        // after "reconsider" the person changes their mind: next time the decision is offered, take the return
        if (!reconsidered && rig.session.engine.actionsFor('es4-decision').some((a) => a.body.kind === 'reply' && a.body.cardId === 'reconsider')) {
          reconsidered = true;
          decisions['g4-decide'] = 'dec-return';
        }
      },
    });
    expect(r.endReason).toBe('diversionSetUp');
    expect(r.stepsShown).toContain('g4-route-return');
  });

  it('every decision met had at least two framed options', () => {
    const r = play({ decisions: { 'g2-deviate': 'dev-left', 'g4-decide': 'dec-continue', 'g4-confirm': 'confirm-continue' } });
    expect(r.decisionsMet.map((d) => d.stepId)).toEqual(['g2-deviate', 'g4-decide', 'g4-confirm']);
    for (const d of r.decisionsMet) expect(d.options, d.stepId).toBeGreaterThanOrEqual(2);
  });

  it('off script: a plain readback of the climb clearance, then the lights: still reaches the end', () => {
    let done = false;
    const r = play({
      decisions: { 'g2-deviate': 'dev-right', 'g4-decide': 'dec-divert-alt1' },
      offScript: (rig) => {
        if (done || !rig.comms.pendingCards().some((c) => c.messageId === 'dep-climb')) return;
        done = true;
        rig.act(rig.comms.choose('dep-climb', 'dep-readback')!);
      },
    });
    expect(done).toBe(true);
    expect(r.endReason).toBe('diversionSetUp');
  });

  it('off script: PA pressed before the decision, then the lights: still reaches the end', () => {
    let done = false;
    const r = play({
      decisions: { 'g2-deviate': 'dev-left', 'g4-decide': 'dec-return' },
      offScript: (rig) => {
        if (done || rig.session.engine.status.eventSetId !== 'es4-decision') return;
        done = true;
        rig.act({ kind: 'control', controlId: 'pa.cabin', value: true });
      },
    });
    expect(done).toBe(true);
    expect(r.endReason).toBe('diversionSetUp');
  });

  describe('text fits the coach strip (0.436 m of text width)', () => {
    // Real Inter advance widths (the headset font) plus 6% for the canvas fallback difference, as in the comms fit test.
    const widthAt = (role: 'min' | 'body') => {
      const face = inter.medium;
      const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
      const em = fontSizeForCap(THEME.text.capM[role]);
      return (t: string) => ([...t].reduce((a, ch) => a + (adv.get(ch) ?? adv.get('n')!), 0) / face.info.size) * em * 1.06;
    };
    const W = 0.436;
    const steps = singleSource.eventSets.flatMap((es) => (es.guide ?? []).map((g) => ({ es, g, count: es.guide!.length })));

    it('the head line "STEP n OF m . WHERE" fits one line at min size', () => {
      const min = widthAt('min');
      for (const { g, count } of steps) expect(min(`STEP ${count} OF ${count} . ${g.where}`), g.id).toBeLessThanOrEqual(W);
    });

    it('text and wait text fit two lines at body size', () => {
      const body = widthAt('body');
      for (const { g } of steps)
        for (const t of [g.text, g.waitText].filter((x): x is string => !!x)) expect(wrapText(t, W, body).length, `${g.id}: ${t}`).toBeLessThanOrEqual(2);
    });
  });
});
