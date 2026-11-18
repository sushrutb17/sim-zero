// Path tests for the "Single Source" scenario: each drives a TrainingSession with scripted
// dispatch/tick calls and asserts the end reason and the Event Set grades.
import { describe, expect, it } from 'vitest';
import type { ControlId } from '../../src/contracts/aircraft';
import type { EventSetGrade, PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import { parseScenario, type Scenario } from '../../src/contracts/scenario';
import { TrainingSession } from '../../src/engine/session';
import singleSource from '../../src/scenarios/single-source';

const DT = 0.1;

function mk() {
  const s = new TrainingSession(singleSource, { mode: 'auto' });
  const cues: Stamped<WorldCue>[] = [];
  s.onCue((c) => cues.push(c));
  s.start();
  const e = s.engine;
  const act = (a: PilotAction) => e.dispatch(a);
  const ctl = (controlId: ControlId, value: number | boolean | string) => act({ kind: 'control', controlId, value });
  const reply = (messageId: string, cardId: string) => act({ kind: 'reply', messageId, cardId });
  const item = (checklistId: string, itemId: string) => act({ kind: 'checklistItem', checklistId, itemId });
  const sentAt = (id: string): number | undefined =>
    cues.find((c) => (c.body.kind === 'message' || c.body.kind === 'alert') && c.body.id === id)?.t;
  const setStartAt = (id: string): number | undefined =>
    cues.find((c) => c.body.kind === 'eventSet' && c.body.eventSetId === id && c.body.status === 'start')?.t;
  const until = (what: string, pred: () => boolean, maxSec = 240) => {
    let t = 0;
    while (!pred()) {
      if (t > maxSec || e.status.run !== 'running') throw new Error(`timed out waiting for ${what} (status ${JSON.stringify(e.status)})`);
      e.tick(DT);
      t += DT;
    }
  };
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += DT) e.tick(DT);
  };
  const waitFor = (id: string) => until(`cue ${id}`, () => sentAt(id) !== undefined);
  const inSet = (id: string) => until(`event set ${id}`, () => e.status.eventSetId === id);
  const grade = (id: string): EventSetGrade => {
    const g = s.results().original.find((x) => x.eventSetId === id);
    if (!g) throw new Error(`no grade for ${id}`);
    return g;
  };
  return { s, e, cues, act, ctl, reply, item, sentAt, setStartAt, until, tick, waitFor, inSet, grade };
}
type Run = ReturnType<typeof mk>;

// --- Correct drives for Event Sets 1-3 -------------------------------------------------------

function es1Good(r: Run) {
  r.tick(2);
  r.reply('twr-hold', 'hold-readback');
  r.ctl('baro.set', 1004);
  r.ctl('ap.hdg', 90);
  r.ctl('ap.alt', 4000);
  r.ctl('lights.landing', true);
  r.ctl('lights.strobe', true);
  r.tick(2);
  for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) r.item('beforeTakeoff', id);
  r.inSet('es2-takeoff-climb');
}

function es2Good(r: Run, dir: 'left' | 'right' = 'left') {
  r.tick(2);
  r.reply('twr-takeoff', 'to-readback');
  r.waitFor('dep-climb');
  r.reply('dep-climb', dir === 'left' ? 'dev-left' : 'dev-right');
  r.ctl('ap.engage', true);
  r.ctl('ap.alt', 12000);
  r.ctl('ap.vertical', 'climb');
  r.ctl('ap.hdg', dir === 'left' ? 60 : 120);
  r.inSet('es3-gen-failure');
}

function es3Good(r: Run, opts: { cycleGenFirst?: boolean } = {}) {
  r.tick(1);
  r.reply('dep-handoff', 'ho-readback');
  if (opts.cycleGenFirst) {
    r.ctl('elec.gen1', false);
    r.tick(1);
    r.ctl('elec.gen1', true);
  }
  r.waitFor('gen1-fail');
  r.tick(2);
  r.act({ kind: 'alertAck', alertId: 'gen1-fail' });
  r.tick(1);
  r.item('genFail', 'gf-identify');
  r.ctl('elec.gen1', false);
  r.item('genFail', 'gf-gen1-off');
  r.ctl('elec.busTie', true);
  r.item('genFail', 'gf-bustie');
  r.item('genFail', 'gf-cabin');
  r.item('genFail', 'gf-review');
  r.waitFor('cab-lights');
  r.reply('cab-lights', 'cab-standby');
  r.waitFor('ctr-query');
  r.reply('ctr-query', 'ctr-report');
  r.inSet('es4-decision');
}

function toEs4(r: Run, opts: { dir?: 'left' | 'right'; cycleGenFirst?: boolean } = {}) {
  es1Good(r);
  es2Good(r, opts.dir);
  es3Good(r, opts);
  r.waitFor('ctr-intentions');
  r.tick(3);
}

/** Request a return or diversion, set the route, inform the cabin. */
function divert(r: Run, card: 'dec-return' | 'dec-divert-alt1' | 'dec-divert-alt2', messageId = 'ctr-intentions') {
  const airport = { 'dec-return': 'dep', 'dec-divert-alt1': 'alt1', 'dec-divert-alt2': 'alt2' }[card];
  r.reply(messageId, card);
  r.tick(3);
  r.ctl('route.destination', airport);
  r.tick(2);
  r.ctl('pa.cabin', true);
  r.waitFor('pa-cabin');
  r.reply('pa-cabin', 'pa-clear');
}

// --- Pilot-visible text walker ------------------------------------------------------------------

function cueStrings(c: WorldCue): string[] {
  switch (c.kind) {
    case 'message':
      return [c.text, ...(c.cards ?? []).map((k) => k.text)];
    case 'printout':
      return [c.title, c.body];
    case 'alert':
      return [c.text];
    default:
      return [];
  }
}

function pilotVisibleStrings(sc: Scenario): string[] {
  return [
    sc.title,
    sc.notice,
    sc.practice.prompt,
    ...sc.briefing.flatMap((b) => [b.title, b.body]),
    ...sc.airports.map((a) => a.name),
    ...sc.checklists.flatMap((c) => [c.title, ...c.items.map((i) => i.text)]),
    ...cueStrings(sc.softTimeout.promptCue),
    ...sc.eventSets.flatMap((es) => [
      es.title,
      es.technical,
      es.crm,
      ...es.hints,
      ...(es.guide ?? []).flatMap((g) => [g.where, g.text, ...(g.waitText ? [g.waitText] : [])]),
      ...es.checks.map((k) => k.reason),
      ...es.startCues.flatMap(cueStrings),
      ...es.rules.flatMap((r) => r.cues.flatMap(cueStrings)),
    ]),
  ];
}

// Real airlines, manufacturers, avionics brands, manufacturer-specific system names, real model
// numbers, and the real emergency/air-to-air frequencies. None may appear anywhere in the file.
const BANNED: RegExp[] = [
  /air canada/i, /westjet/i, /porter airlines/i, /\bjazz\b/i, /flair/i, /sunwing/i, /transat/i,
  /lufthansa/i, /british airways/i, /air france/i, /\bklm\b/i, /emirates/i, /qantas/i, /\bdelta\b/i,
  /united airlines/i, /american airlines/i, /southwest airlines/i, /ryanair/i, /easyjet/i, /cathay/i,
  /singapore airlines/i, /air new zealand/i, /alaska airlines/i, /jetblue/i, /meridiana/i, /meridian/i, /westhollow/i,
  /\bboeing\b/i, /\bairbus\b/i, /embraer/i, /bombardier/i, /de ?havilland/i, /\batr\b/i, /cessna/i,
  /gulfstream/i, /lockheed/i, /mcdonnell/i, /douglas/i, /dassault/i, /\bsaab\b/i, /comac/i, /sukhoi/i,
  /rolls-?royce/i, /pratt/i, /\bcfm\b/i, /general electric/i, /honeywell/i, /\bcollins\b/i, /garmin/i,
  /thales/i, /jeppesen/i, /\becam\b/i, /\beicas\b/i, /\bA3[0-9]{2}\b/, /\b7[0-9]7\b/, /\bdash ?8\b/i,
  /121[.,]5\b/, /123[.,]45\b/, /\b243[.,]0\b/,
];

// --- Tests -----------------------------------------------------------------------------------------

describe('Single Source scenario', () => {
  it('parses', () => {
    const sc = parseScenario(structuredClone(singleSource));
    expect(sc.eventSets.map((x) => x.id)).toEqual(['es1-before-takeoff', 'es2-takeoff-climb', 'es3-gen-failure', 'es4-decision']);
    expect(sc.checklists.map((c) => c.id).sort()).toEqual(['beforeTakeoff', 'genFail']);
    expect(sc.airports.map((a) => a.id).sort()).toEqual(['alt1', 'alt2', 'dep', 'dest']);
    expect(sc.timeCompression).toBe(6);
    expect(sc.latenessGraceSec).toBe(10);
    expect(sc.softTimeout).toMatchObject({ eventSetId: 'es4-decision', promptAtSec: 120, afterSec: 180 });
    expect(sc.initialAircraft).toMatchObject({
      phase: 'holding',
      headingDeg: 90,
      altitudeFt: 0,
      elec: { backupGenInop: true, gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false } },
    });
    for (const es of sc.eventSets) {
      expect(es.hints.length).toBeGreaterThanOrEqual(1);
      expect(es.hints.length).toBeLessThanOrEqual(2);
    }
    const before = sc.checklists.find((c) => c.id === 'beforeTakeoff')!.items.length;
    const gen = sc.checklists.find((c) => c.id === 'genFail')!.items.length;
    expect(before).toBeGreaterThanOrEqual(4);
    expect(before).toBeLessThanOrEqual(6);
    expect(gen).toBeGreaterThanOrEqual(4);
    expect(gen).toBeLessThanOrEqual(6);
    expect(sc.notice).toMatch(/generic/i);
    expect(sc.notice).toMatch(/fictional/i);
  });

  it('happy path return → diversionSetUp, all 4', () => {
    const r = mk();
    toEs4(r);
    divert(r, 'dec-return');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(r.e.state.destination).toBe('dep');
    const grades = r.s.results().original;
    expect(grades.map((g) => g.eventSetId)).toEqual(['es1-before-takeoff', 'es2-takeoff-climb', 'es3-gen-failure', 'es4-decision']);
    for (const g of grades) expect({ id: g.eventSetId, grade: g.grade, reasons: g.reasons }).toEqual({ id: g.eventSetId, grade: 4, reasons: [] });
    expect(grades.every((g) => !g.hintUsed)).toBe(true);
  });

  it('generator 1 fails when climbing through 10,000 ft', () => {
    const r = mk();
    es1Good(r);
    es2Good(r);
    expect(r.e.state.altitudeFt).toBeLessThan(10000);
    r.waitFor('gen1-fail');
    expect(r.e.state.altitudeFt).toBeGreaterThanOrEqual(10000);
    expect(r.e.state.altitudeFt).toBeLessThan(10400);
    expect(r.e.state.elec.gen1.failed).toBe(true);
  });

  it('deviation right is graded same as left', () => {
    const left = mk();
    toEs4(left, { dir: 'left' });
    const right = mk();
    toEs4(right, { dir: 'right' });
    expect(right.e.state.headingDeg).toBeGreaterThanOrEqual(110);
    divert(left, 'dec-return');
    divert(right, 'dec-return');
    expect(right.grade('es2-takeoff-climb')).toEqual(left.grade('es2-takeoff-climb'));
    expect(right.grade('es2-takeoff-climb').grade).toBe(4);
  });

  it('divert alt1 → diversionSetUp, ES4 = 4', () => {
    const r = mk();
    toEs4(r);
    divert(r, 'dec-divert-alt1');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(r.e.state.destination).toBe('alt1');
    expect(r.grade('es4-decision')).toMatchObject({ grade: 4, reasons: [] });
  });

  it('divert alt2 → ES4 ≤ 2 with decision reason', () => {
    const r = mk();
    toEs4(r);
    divert(r, 'dec-divert-alt2');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    const g = r.grade('es4-decision');
    expect(g.grade).toBeLessThanOrEqual(2);
    expect(g.reasons[0].text).toMatch(/Isle Morrow/);
  });

  it('continue then confirm → continueConfirmed, ES4 = 1, safety reason first', () => {
    const r = mk();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-continue');
    r.waitFor('dsp-concern');
    expect(r.cues.filter((c) => c.body.kind === 'message' && c.body.channel === 'dispatch' && c.t >= r.sentAt('dsp-concern')!)).toHaveLength(1);
    r.tick(3);
    r.reply('dsp-concern', 'confirm-continue');
    r.waitFor('ctr-ack-continue');
    r.ctl('pa.cabin', true);
    r.waitFor('pa-cabin');
    r.reply('pa-cabin', 'pa-clear');
    expect(r.e.status.endReason).toBe('continueConfirmed');
    const g = r.grade('es4-decision');
    expect(g.grade).toBe(1);
    expect(g.reasons[0].text).toMatch(/safety-of-flight/i);
    expect(g.reasons[0].text).toMatch(/generator/i);
  });

  it('continue then reconsider then return → ES4 ≤ 3', () => {
    const r = mk();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-continue');
    r.waitFor('dsp-concern');
    r.tick(3);
    r.reply('dsp-concern', 'reconsider');
    r.waitFor('dsp-reoffer');
    r.tick(2);
    divert(r, 'dec-return', 'dsp-reoffer');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(r.sentAt('ctr-ack-return')).toBeDefined();
    const g = r.grade('es4-decision');
    expect(g.grade).toBe(2); // corrected major error
    expect(g.reasons.some((x) => /continu/i.test(x.text))).toBe(true);
  });

  it('no decision → timeout at 180s with prompt at 120s, ES4 = 1 "decision not made in time"', () => {
    const r = mk();
    toEs4(r);
    const es4Start = r.setStartAt('es4-decision')!;
    r.tick(400);
    expect(r.e.status.run).toBe('ended');
    expect(r.e.status.endReason).toBe('timeout');
    const promptAt = r.sentAt('ctr-say-intentions');
    expect(promptAt).toBeDefined();
    expect(promptAt! - es4Start).toBeCloseTo(120, 0);
    const endCue = r.cues.find((c) => c.body.kind === 'scenarioEnd')!;
    expect(endCue.t - es4Start).toBeCloseTo(180, 0);
    const g = r.grade('es4-decision');
    expect(g.grade).toBe(1);
    expect(g.reasons[0].text).toMatch(/decision not made in time/i);
  });

  it('gen switch cycled before failure path → ES3 has an error-trap reason, no crash (corrected: GEN 1 left off)', () => {
    const r = mk();
    toEs4(r, { cycleGenFirst: true });
    divert(r, 'dec-divert-alt1');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    const g = r.grade('es3-gen-failure');
    expect(g.grade).toBe(3); // corrected minor error
    expect(g.reasons.map((x) => x.text)).toEqual(['GEN 1 was switched off and on again; this checklist does not call for a reset.']);
    expect(r.grade('es4-decision').grade).toBe(4);
  });

  it('GEN 1 reset after the checklist and left on → uncorrected minor error, ES3 = 2', () => {
    const r = mk();
    es1Good(r);
    es2Good(r);
    r.tick(1);
    r.reply('dep-handoff', 'ho-readback');
    r.waitFor('gen1-fail');
    r.tick(2);
    r.act({ kind: 'alertAck', alertId: 'gen1-fail' });
    r.tick(1);
    r.ctl('elec.gen1', false);
    r.ctl('elec.busTie', true);
    for (const id of ['gf-identify', 'gf-gen1-off', 'gf-bustie', 'gf-cabin', 'gf-review']) r.item('genFail', id);
    r.tick(2);
    r.ctl('elec.gen1', true); // reset attempt, never switched off again
    r.waitFor('cab-lights');
    r.reply('cab-lights', 'cab-standby');
    r.waitFor('ctr-query');
    r.reply('ctr-query', 'ctr-report');
    r.inSet('es4-decision');
    r.waitFor('ctr-intentions');
    divert(r, 'dec-return');
    const g = r.grade('es3-gen-failure');
    expect(g.grade).toBe(2);
    expect(g.reasons[0].text).toMatch(/GEN 1 was switched off and on again/);
  });

  it('switching off the working generator is a major error and raises a warning', () => {
    const r = mk();
    es1Good(r);
    es2Good(r);
    r.tick(1);
    r.reply('dep-handoff', 'ho-readback');
    r.waitFor('gen1-fail');
    r.act({ kind: 'alertAck', alertId: 'gen1-fail' });
    r.ctl('elec.gen2', false);
    r.tick(1);
    expect(r.sentAt('elec-no-gen')).toBeDefined();
    r.tick(30);
    r.ctl('elec.gen2', true);
    for (const id of ['gf-identify', 'gf-gen1-off', 'gf-bustie', 'gf-cabin', 'gf-review']) r.item('genFail', id);
    r.ctl('elec.gen1', false);
    r.ctl('elec.busTie', true);
    r.waitFor('cab-lights');
    r.reply('cab-lights', 'cab-standby');
    r.waitFor('ctr-query');
    r.reply('ctr-query', 'ctr-report');
    r.inSet('es4-decision');
    r.waitFor('ctr-intentions');
    divert(r, 'dec-return');
    const g = r.grade('es3-gen-failure');
    expect(g.grade).toBe(1);
    expect(g.reasons[0].text).toMatch(/GEN 2/);
  });

  it('tapping through the before-takeoff checklist without setting anything grades ES1 = 1', () => {
    const r = mk();
    for (const id of ['bt-altimeter', 'bt-autopilot', 'bt-lights', 'bt-elec', 'bt-brief']) r.item('beforeTakeoff', id);
    expect(r.e.status.eventSetId).toBe('es2-takeoff-climb');
    // Not ended yet; grade appears at scenario end. Drive the rest correctly, then check ES1.
    r.tick(1);
    r.ctl('baro.set', 1004);
    r.ctl('ap.alt', 4000);
    es2Good(r);
    es3Good(r);
    r.waitFor('ctr-intentions');
    divert(r, 'dec-return');
    const g = r.grade('es1-before-takeoff');
    expect(g.grade).toBe(1);
    expect(g.reasons.some((x) => /altimeter/i.test(x.text))).toBe(true);
  });

  it('a hint in ES4 is recorded and the decision counts as prompted', () => {
    const r = mk();
    toEs4(r);
    r.act({ kind: 'hint', eventSetId: 'es4-decision' });
    divert(r, 'dec-return');
    const g = r.grade('es4-decision');
    expect(g.hintUsed).toBe(true);
    expect(g.grade).toBe(2);
  });

  it('every set end is reachable without the ATC weather call being answered first (late deviation)', () => {
    const r = mk();
    es1Good(r);
    r.reply('twr-takeoff', 'to-readback');
    r.waitFor('dep-climb');
    r.reply('dep-climb', 'dep-readback');
    r.ctl('ap.engage', true);
    r.ctl('ap.alt', 12000);
    r.ctl('ap.vertical', 'climb');
    r.waitFor('atc-wx');
    r.reply('atc-wx', 'dev-right');
    r.ctl('ap.hdg', 120);
    r.inSet('es3-gen-failure');
    es3Good(r);
    r.waitFor('ctr-intentions');
    divert(r, 'dec-return');
    const g = r.grade('es2-takeoff-climb');
    expect(g.grade).toBe(3);
    expect(g.reasons[0].text).toMatch(/storm/i);
  });

  it('decision committed, then 120 s passes → no "confirm intentions" prompt; timeout still ends at 180 s', () => {
    const r = mk();
    toEs4(r);
    const es4Start = r.setStartAt('es4-decision')!;
    r.reply('ctr-intentions', 'dec-return');
    r.tick(130);
    expect(r.sentAt('ctr-say-intentions')).toBeUndefined();
    r.tick(60);
    expect(r.e.status.endReason).toBe('timeout');
    expect(r.cues.find((c) => c.body.kind === 'scenarioEnd')!.t - es4Start).toBeCloseTo(180, 0);
    expect(r.sentAt('ctr-say-intentions')).toBeUndefined();
  });

  it('ES2 fallback: a pilot who never takes off reaches ES3 at 150 s, and GEN 1 still fails', () => {
    const r = mk();
    es1Good(r);
    const es2Start = r.setStartAt('es2-takeoff-climb')!;
    r.inSet('es3-gen-failure');
    expect(r.setStartAt('es3-gen-failure')! - es2Start).toBeCloseTo(150, 0);
    expect(r.e.state.altitudeFt).toBeLessThan(10000);
    r.waitFor('gen1-fail');
    expect(r.sentAt('gen1-fail')! - r.setStartAt('es3-gen-failure')!).toBeCloseTo(50, 0);
    r.inSet('es4-decision'); // ES3 fallback too
    r.tick(200);
    expect(r.e.status.endReason).toBe('timeout');
    const g = r.s.results().original;
    expect(g.map((x) => x.grade)).toEqual([4, 1, 1, 1]);
  });

  it('never-engaged pilot still reaches the debrief', () => {
    // Selects climb and an altitude but never engages the autopilot: the aircraft must not climb
    // (the cockpit must not mislead), and Event Sets 1-3 end by their 150 s fallbacks.
    const r = mk();
    r.ctl('ap.alt', 12000);
    r.ctl('ap.vertical', 'climb');
    const es1Start = r.setStartAt('es1-before-takeoff') ?? 0;
    r.inSet('es2-takeoff-climb');
    expect(r.setStartAt('es2-takeoff-climb')! - es1Start).toBeCloseTo(150, 0);
    r.reply('twr-takeoff', 'to-readback'); // the aircraft is now airborne (takeoff phase), AP still off
    r.inSet('es3-gen-failure');
    expect(r.setStartAt('es3-gen-failure')! - r.setStartAt('es2-takeoff-climb')!).toBeCloseTo(150, 0);
    expect(r.e.state.phase).not.toBe('holding');
    const airborneAlt = r.e.state.altitudeFt;
    expect(airborneAlt).toBeGreaterThan(0);
    r.waitFor('gen1-fail');
    expect(r.sentAt('gen1-fail')! - r.setStartAt('es3-gen-failure')!).toBeCloseTo(50, 0); // fallback, not the 10,000 ft trigger
    expect(r.e.state.altitudeFt).toBe(airborneAlt);
    expect(r.e.state.elec.gen1.failed).toBe(true);
    r.inSet('es4-decision');
    expect(r.setStartAt('es4-decision')! - r.setStartAt('es3-gen-failure')!).toBeCloseTo(150, 0);
    r.tick(400);
    expect(r.e.status.run).toBe('ended');
    expect(r.e.status.endReason).toBe('timeout');
    expect(r.s.results().original.map((x) => x.eventSetId)).toEqual(['es1-before-takeoff', 'es2-takeoff-climb', 'es3-gen-failure', 'es4-decision']);
  });

  it('PA cards stay available: pa-cabin answered long after it was sent still ends diversionSetUp, ES4 = 4', () => {
    const r = mk();
    toEs4(r);
    r.ctl('pa.cabin', true); // before the decision: nothing yet
    expect(r.sentAt('pa-cabin')).toBeUndefined();
    r.reply('ctr-intentions', 'dec-return'); // acks and the PA cards arrive together
    expect(r.sentAt('pa-cabin')).toBeDefined();
    r.ctl('route.destination', 'dep');
    r.tick(100); // other messages are long past; the PA cards are still answerable
    expect(r.e.status.run).toBe('running');
    r.reply('pa-cabin', 'pa-clear');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(r.grade('es4-decision')).toMatchObject({ grade: 4, reasons: [] });
  });

  it('dispatch acknowledgements remind the pilot to brief the cabin', () => {
    const r = mk();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-divert-alt1');
    const ack = r.cues.find((c) => c.body.kind === 'message' && c.body.id === 'dsp-ack-alt1')!.body;
    expect(ack.kind === 'message' && ack.text).toMatch(/brief the cabin/);
  });

  it('ES2: no weather call after an approved deviation, even before the autopilot turns', () => {
    const r = mk();
    es1Good(r);
    r.reply('twr-takeoff', 'to-readback');
    r.waitFor('dep-climb');
    r.reply('dep-climb', 'dev-left');
    r.tick(40); // AP not engaged: still on heading 090
    expect(r.e.state.headingDeg).toBe(90);
    expect(r.sentAt('atc-wx')).toBeUndefined();
  });

  it('all pilot-visible strings are printable ASCII', () => {
    const sc = parseScenario(structuredClone(singleSource));
    const strings = pilotVisibleStrings(sc);
    expect(strings.length).toBeGreaterThan(50);
    const bad = strings.filter((s) => !/^[\x20-\x7E\n]*$/.test(s));
    expect(bad).toEqual([]);
    // The whole file, instructor text included (newlines appear escaped in JSON).
    const json = JSON.stringify(sc);
    expect(json.match(/[^\x20-\x7E]/g)).toBeNull();
  });

  it('pilot-visible strings contain no banned terms', () => {
    const sc = parseScenario(structuredClone(singleSource));
    const visible = pilotVisibleStrings(sc).join('\n');
    const everything = JSON.stringify(sc);
    for (const re of BANNED) {
      expect(visible, `pilot-visible text matches ${re}`).not.toMatch(re);
      expect(everything, `scenario file matches ${re}`).not.toMatch(re);
    }
    // No four-letter airport codes: airport names are words, not codes.
    for (const a of sc.airports) expect(a.name).not.toMatch(/^[A-Z]{4}$/);
  });
});

const FIRST_OFFICER_IDS = ['fo-es1-checklist', 'fo-es2-airborne', 'fo-es2-ap', 'fo-es2-clear', 'fo-es3-fault', 'fo-es3-checklist', 'fo-es3-gen1-off', 'fo-es3-bustie', 'fo-es3-complete', 'fo-es4-route', 'fo-es4-cabin'];
const crewMessages = (r: Run) => r.cues.flatMap(c => c.body.kind === 'message' && c.body.channel === 'crew' ? [c.body] : []);
const crewRules = () => singleSource.eventSets.flatMap(es => es.rules).filter(r => r.id.startsWith('fo-'));

it('first officer: all eleven lines are sent on the happy path, each once', () => {
  const r = mk(); toEs4(r); divert(r, 'dec-return');
  expect(crewMessages(r).map(c => c.id).sort()).toEqual([...FIRST_OFFICER_IDS].sort());
});
it('first officer: every crew message has no reply cards and no comm check names it', () => {
  const rules = crewRules(); expect(rules).toHaveLength(11);
  for (const rule of rules) {
    expect(rule.once).not.toBe(false);
    expect(rule.cues).toHaveLength(1);
    expect(rule.cues[0]).toMatchObject({ kind: 'message', id: rule.id, channel: 'crew' });
    const cue = rule.cues[0]; expect(cue.kind === 'message' && (cue.cards?.length ?? 0)).toBe(0);
  }
  const comms = singleSource.eventSets.flatMap(es => es.checks).flatMap(c => c.kind === 'comm' ? [c.messageId] : []);
  expect(comms.filter(id => FIRST_OFFICER_IDS.includes(id))).toEqual([]);
});
it('first officer: GEN 1 is off is not sent before failure even when cycled earlier', () => {
  const r = mk(); es1Good(r); es2Good(r); r.ctl('elec.gen1', false); r.tick(1);
  expect(r.sentAt('fo-es3-gen1-off')).toBeUndefined(); r.ctl('elec.gen1', true);
  r.waitFor('gen1-fail'); r.ctl('elec.gen1', false);
  expect(r.sentAt('fo-es3-gen1-off')).toBeGreaterThanOrEqual(r.sentAt('gen1-fail')!);
});
it('first officer: no line is sent in Event Set 2 before takeoff', () => {
  const r = mk(); es1Good(r); r.ctl('ap.engage', true); r.ctl('ap.hdg', 60); r.tick(10);
  expect(crewMessages(r).filter(c => c.id.startsWith('fo-es2-'))).toEqual([]);
});
it('first officer: lines never contain should, recommend, storm, one generator or backup', () => {
  for (const rule of crewRules()) for (const c of rule.cues) if (c.kind === 'message') expect(c.text).not.toMatch(/should|recommend|storm|one generator|backup/i);
});
it('first officer: with GEN 2 switched off, bus tie on does not claim GEN 2 powers both buses; it does once GEN 2 is back on', () => {
  const r = mk(); es1Good(r); es2Good(r); r.waitFor('gen1-fail'); r.ctl('elec.gen2', false); r.ctl('elec.busTie', true); r.tick(2);
  expect(r.sentAt('fo-es3-bustie')).toBeUndefined();
  r.ctl('elec.gen2', true); r.tick(1);
  expect(r.sentAt('fo-es3-bustie')).toBeDefined();
});
it('first officer: wrong-switch path GEN 2 off sends no crew line about GEN 2', () => {
  const r = mk(); es1Good(r); es2Good(r); r.waitFor('gen1-fail'); r.ctl('elec.gen2', false); r.tick(2);
  expect(crewMessages(r).filter(c => /GEN 2/.test(c.text))).toEqual([]);
});
