import { describe, expect, it } from 'vitest';
import { parseScenario, type Scenario } from '../../src/contracts/scenario';
import type { EventSetGrade, PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import type { ControlId } from '../../src/contracts/aircraft';
import { TrainingSession } from '../../src/engine/session';
import { crossCheck } from '../../src/scenarios/cross-check';
import { allScenarios, flightById } from '../../src/scenarios/registry';
import { singleSource } from '../../src/scenarios/single-source';
import { timeCritical } from '../../src/scenarios/time-critical';
import { CommsModel } from '../../src/xr/panels/panelModel';

type Message = Extract<WorldCue, { kind: 'message' }>;
const cuesOf = (): WorldCue[] => [crossCheck.softTimeout.promptCue, ...crossCheck.eventSets.flatMap(es => [...es.startCues, ...es.rules.flatMap(r => r.cues)])];
const messagesOf = (): Message[] => cuesOf().filter((c): c is Message => c.kind === 'message');

describe('Cross-Check content', () => {
  it('passes the frozen contract with three Event Sets, three hints each, no guide and the completed end condition', () => {
    expect(parseScenario(structuredClone(crossCheck))).toEqual(crossCheck);
    expect(crossCheck).toMatchObject({ id: 'cross-check', title: 'Cross-Check' });
    expect(crossCheck.notice).toContain('Voices are computer-generated.');
    expect(crossCheck.eventSets.map(es => es.id)).toEqual(['cc-es1-late-change', 'cc-es2-similar-callsign', 'cc-es3-level-off']);
    for (const es of crossCheck.eventSets) {
      expect(es.hints).toHaveLength(3);
      expect(es.guide).toBeUndefined();
      for (const f of ['title', 'phase', 'environment', 'trigger', 'technical', 'crm', 'objective', 'instructorNotes'] as const) expect(es[f].length, `${es.id}.${f}`).toBeGreaterThan(0);
      expect(es.distracters.length).toBeGreaterThan(0);
    }
    expect(crossCheck.checklists.map(c => c.title)).toEqual(['AMENDED DEPARTURE']);
    expect(crossCheck.checklists[0].items).toHaveLength(4);
    expect(crossCheck.softTimeout.eventSetId).toBe('cc-es3-level-off');
    expect(crossCheck.endConditions.map(e => e.reason)).toEqual(['completed']);
  });

  it('starts holding short with the old numbers, no storm and no failure', () => {
    expect(crossCheck.initialAircraft).toMatchObject({
      phase: 'holding', altitudeFt: 0, headingDeg: 270, speedKt: 0, baroHpa: 1011, stormBearingDeg: null, destination: 'cc-dest',
      ap: { engaged: false, hdg: 270, alt: 4000, lateral: 'hdg', vertical: 'hold' }, lights: { landing: true, strobe: true },
      elec: { gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false }, backupGenInop: false },
    });
    for (const c of cuesOf()) if (c.kind === 'aircraft') expect(Object.keys(c.patch).sort()).toEqual(['altitudeFt', 'phase', 'speedKt']);
    expect(crossCheck.briefing.map(b => b.body).join(' ')).toMatch(/transition altitude is 6,000 ft.*1013/);
  });

  it('uses only ASCII text, original airport names and unique cc- ids, each voiced only by its own clip', () => {
    expect(JSON.stringify(crossCheck)).toMatch(/^[\x20-\x7E]+$/);
    const others = allScenarios().filter(s => s.id !== 'cross-check');
    expect(others.length).toBeGreaterThan(1);
    for (const a of crossCheck.airports) for (const o of others) expect(o.airports.map(x => x.name)).not.toContain(a.name);
    expect(crossCheck.airports.map(a => a.id).every(id => id.startsWith('cc-'))).toBe(true);
    const messages = messagesOf();
    expect(new Set(messages.map(c => c.id)).size).toBe(messages.length);
    for (const c of messages) { expect(c.id).toMatch(/^cc-/); if (c.audio !== undefined) expect(c.audio, c.id).toBe(`/audio/voice/${c.id}.mp3`); }
    // Every other id in the file is prefixed too, and unique.
    const ids = [
      ...crossCheck.checklists.flatMap(c => [c.id, ...c.items.map(i => i.id)]),
      ...crossCheck.briefing.map(b => b.id),
      ...crossCheck.eventSets.flatMap(es => [es.id, ...es.rules.map(r => r.id), ...es.checks.map(k => k.id)]),
      ...messages.flatMap(m => (m.cards ?? []).map(k => k.id)),
    ];
    for (const id of ids) expect(id).toMatch(/^cc-/);
    expect(new Set(ids).size).toBe(ids.length);
    // One message id, one text, across every flight (a clip is chosen by id).
    const text = new Map<string, string>();
    for (const sc of allScenarios()) for (const es of sc.eventSets) for (const c of [...es.startCues, ...es.rules.flatMap(r => r.cues)]) {
      if (c.kind !== 'message') continue;
      if (text.has(c.id)) expect(text.get(c.id), c.id).toBe(c.text);
      text.set(c.id, c.text);
    }
    for (const sc of [singleSource, timeCritical]) for (const es of sc.eventSets) for (const c of [...es.startCues, ...es.rules.flatMap(r => r.cues)])
      if (c.kind === 'message') expect(c.id.startsWith('cc-')).toBe(false);
  });

  it('gives every comm check an exact quality map and keeps the callsign pair in the plan', () => {
    for (const es of crossCheck.eventSets) for (const k of es.checks) if (k.kind === 'comm') {
      const m = messagesOf().find(x => x.id === k.messageId);
      expect(m, k.id).toBeDefined();
      expect(Object.keys(k.quality).sort()).toEqual((m!.cards ?? []).map(c => c.id).sort());
    }
    const all = JSON.stringify(crossCheck);
    expect(all).toContain('Corvane 471');
    expect(all).toContain('Corvane 417');
    for (const m of messagesOf()) if (m.channel !== 'crew' && m.cards) expect(m.cards.length, m.id).toBeGreaterThanOrEqual(1);
  });

  it.each([-1, 1, 0.5, NaN, Infinity, -Infinity])('rejects invalid Cross-Check variation index %s', index => {
    expect(() => flightById('cross-check')!.build(index)).toThrow(RangeError);
  });

  it('registers one unguided six-minute flight after Time Critical', () => {
    const f = flightById('cross-check');
    expect(f).toMatchObject({ id: 'cross-check', title: 'Cross-Check', blurb: 'A late change and a busy frequency', minutes: 6, guided: false, variations: 1 });
    expect(f?.build(0)).toBe(crossCheck);
    const order = allScenarios().map(s => s.id);
    expect(order.indexOf('cross-check')).toBe(order.indexOf('time-critical') + 1);
  });
});

// ---------------------------------------------------------------------------
// Fly-throughs. The harness drives a TrainingSession through the real CommsModel, as the cockpit would.
function mk(scenario: Scenario = crossCheck) {
  const s = new TrainingSession(scenario, { mode: 'auto' });
  const cues: Stamped<WorldCue>[] = [];
  const comms = new CommsModel();
  const opened = new Set<string>();
  s.onCue(c => {
    cues.push(c);
    comms.apply(c.body);
    if (c.body.kind === 'checklistAvailable') opened.add(c.body.checklistId);
  });
  s.start();
  const e = s.engine;
  const act = (a: PilotAction) => e.dispatch(a);
  const ctl = (controlId: ControlId, value: number | boolean | string) => act({ kind: 'control', controlId, value });
  const reply = (messageId: string, cardId: string) => {
    const action = comms.choose(messageId, cardId);
    expect(action, `reachable card ${messageId}/${cardId}`).toEqual({ kind: 'reply', messageId, cardId });
    act(action!);
  };
  const item = (checklistId: string, itemId: string) => {
    expect(opened.has(checklistId)).toBe(true);
    expect(crossCheck.checklists.find(c => c.id === checklistId)?.items.map(i => i.id)).toContain(itemId);
    act({ kind: 'checklistItem', checklistId, itemId });
  };
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
  };
  const until = (predicate: () => boolean, what: string, maxSec = 240) => {
    let t = 0;
    while (!predicate()) {
      if (t > maxSec || e.status.run !== 'running') throw new Error(`Waiting for ${what}: ${JSON.stringify(e.status)} alt ${e.state.altitudeFt}`);
      e.tick(0.1); t += 0.1;
    }
  };
  const sent = (id: string) => cues.some(c => c.body.kind === 'message' && c.body.id === id);
  const sentCount = (id: string) => cues.filter(c => c.body.kind === 'message' && c.body.id === id).length;
  const wait = (id: string, maxSec = 240) => until(() => sent(id), id, maxSec);
  const inSet = (id: string) => until(() => e.status.eventSetId === id, id);
  const grade = (id: string): EventSetGrade => {
    const g = s.results().original.find(g => g.eventSetId === id);
    if (!g) throw new Error(`Missing grade ${id}`);
    return g;
  };
  return { s, e, cues, comms, act, ctl, reply, item, tick, until, wait, sent, sentCount, inSet, grade };
}
type Run = ReturnType<typeof mk>;

const SETTINGS: [ControlId, number][] = [['ap.alt', 5000], ['ap.hdg', 240], ['baro.set', 1008]];
const ES1 = 'cc-es1-late-change';
const ES2 = 'cc-es2-similar-callsign';
const ES3 = 'cc-es3-level-off';

function setSettings(r: Run) { for (const [c, v] of SETTINGS) r.ctl(c, v); }
function amendedChecklist(r: Run) { for (const i of crossCheck.checklists[0].items) r.item('cc-amended', i.id); }
function late(r: Run, opts: { amend?: string; standby?: boolean; fixAfterReady?: boolean; skipSettings?: boolean } = {}) {
  r.tick(2);
  r.reply('cc-twr-amend', opts.amend ?? 'cc-amend-readback');
  if (!opts.fixAfterReady && !opts.skipSettings) { setSettings(r); amendedChecklist(r); }
  r.wait('cc-twr-ready');
  if (opts.standby) {
    r.reply('cc-twr-ready', 'cc-ready-standby');
    r.tick(1);
    r.reply('cc-twr-report', 'cc-report-ready');
  } else r.reply('cc-twr-ready', 'cc-ready-now');
  if (opts.fixAfterReady) { r.tick(2); setSettings(r); amendedChecklist(r); }
  r.reply('cc-twr-takeoff', 'cc-takeoff-readback');
  r.inSet(ES2);
}
function climb(r: Run) { r.ctl('ap.engage', true); r.ctl('ap.vertical', 'climb'); }
function callsign(r: Run, opts: { call?: 'cc-say-again' | 'cc-not-ours' | 'cc-readback-160'; altitude?: number; fixTo14?: boolean; skipClimb?: boolean } = {}) {
  if (!opts.skipClimb) climb(r);
  r.reply('cc-dep-contact', 'cc-dep-readback');
  r.wait('cc-atc-417');
  r.reply('cc-atc-417', opts.call ?? 'cc-say-again');
  r.wait('cc-atc-real');
  r.reply('cc-atc-real', 'cc-real-readback');
  if (opts.altitude !== undefined) {
    r.ctl('ap.alt', opts.altitude);
    if (opts.fixTo14) { r.tick(5); r.ctl('ap.alt', 14000); }
  } else r.ctl('ap.alt', 14000);
}
function toLevelOff(r: Run) { late(r); callsign(r); r.inSet(ES3); }
function levelOff(r: Run, opts: { cabinFirst?: boolean; cabinCard?: string } = {}) {
  r.wait('cc-atc-stop');
  if (opts.cabinFirst) r.reply('cc-cabin-galley', opts.cabinCard ?? 'cc-cabin-standby');
  r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013);
  r.reply('cc-atc-stop', 'cc-stop-readback');
  if (!opts.cabinFirst) r.reply('cc-cabin-galley', opts.cabinCard ?? 'cc-cabin-standby');
  if ((opts.cabinCard ?? 'cc-cabin-standby') === 'cc-cabin-standby') { r.wait('cc-cabin-callback'); r.reply('cc-cabin-callback', 'cc-callback-go'); }
  r.until(() => r.e.status.run !== 'running', 'the end');
}
const grades = (r: Run) => r.s.results().original.map(g => g.grade);
const reasonText = (r: Run, id: string) => r.grade(id).reasons.map(x => x.text).join(' | ');

describe('Cross-Check fly-throughs', () => {
  it('best path (settings first, query the callsign, standby the cabin) grades 4, 4, 4 and completes', () => {
    const r = mk(); toLevelOff(r); levelOff(r);
    expect(r.e.status).toMatchObject({ run: 'ended', endReason: 'completed' });
    expect(grades(r)).toEqual([4, 4, 4]);
    expect(r.e.state).toMatchObject({ altitudeFt: 11000, baroHpa: 1013, destination: 'cc-dest', ap: { alt: 11000, engaged: true, vertical: 'climb' } });
    expect(r.cues.filter(c => c.body.kind === 'message' && c.body.channel === 'crew').map(c => c.body.kind === 'message' && c.body.id)).toEqual(['cc-crew-positive', 'cc-crew-transition']);
    expect(r.cues.some(c => c.body.kind === 'scenarioEnd' && c.body.reason === 'completed')).toBe(true);
    expect(r.sent('cc-cabin-report')).toBe(true);
    expect(r.sent('cc-timeout-reminder')).toBe(false);
  });

  it('answering "standby" to the immediate departure and fixing the settings first also grades 4, 4, 4', () => {
    const r = mk(); late(r, { standby: true }); callsign(r); r.inSet(ES3); levelOff(r, { cabinCard: 'cc-cabin-goahead' });
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 4, 4]);
    expect(r.sent('cc-twr-report')).toBe(true);
    expect(r.sent('cc-cabin-callback')).toBe(false);
  });

  it('accepting the immediate departure with the old settings, then fixing them before takeoff, is a corrected major trap (grade 2)', () => {
    const r = mk(); late(r, { fixAfterReady: true }); callsign(r); r.inSet(ES3); levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([2, 4, 4]);
    expect(r.grade(ES1).reasons).toEqual([{ category: 'procedures', text: expect.stringMatching(/immediate departure was accepted.*old numbers/) }]);
  });

  it('accepting the immediate departure and never fixing the settings is an uncorrected major error (grade 1); the flight still completes', () => {
    const r = mk(); late(r, { skipSettings: true }); callsign(r); r.inSet(ES3); levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([1, 4, 4]);
    const reasons = r.grade(ES1).reasons;
    expect(reasons.map(x => x.text).join(' ')).toMatch(/altitude was not set.*heading was not set.*altimeter was not set|altitude, heading or altimeter|not set to the amended/);
    expect(r.e.snapshotAt(ES2).state).toMatchObject({ baroHpa: 1011, ap: { alt: 4000, hdg: 270 } });
  });

  it('a read-back with a wrong number lowers Event Set 1 to 3 and Tower repeats the numbers without blocking', () => {
    const r = mk(); late(r, { amend: 'cc-amend-wrong' }); callsign(r); r.inSet(ES3); levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([3, 4, 4]);
    expect(reasonText(r, ES1)).toContain('not read back correctly');
    expect(r.sent('cc-twr-amend-correct')).toBe(true);
  });

  it.each([['cc-say-again', 'cc-atc-for-417', 4], ['cc-not-ours', null, 4], ['cc-readback-160', 'cc-atc-negative', 3]] as const)(
    'the %s reply to the other flight call still reaches the real clearance once (%s, grade %s)', (call, follow, expected) => {
      const r = mk(); late(r); callsign(r, { call }); r.inSet(ES3); levelOff(r);
      expect(r.e.status.endReason).toBe('completed');
      expect(r.sentCount('cc-atc-real')).toBe(1);
      if (follow) expect(r.sentCount(follow)).toBe(1);
      expect(grades(r)).toEqual([4, expected, 4]);
      if (call === 'cc-readback-160') expect(reasonText(r, ES2)).toContain('read back as Corvane 471');
    });

  it('with no reply to the other flight call, ATC gives the real clearance 12 s later', () => {
    const r = mk(); late(r); climb(r); r.reply('cc-dep-contact', 'cc-dep-readback');
    r.wait('cc-atc-417');
    const call = r.cues.find(c => c.body.kind === 'message' && c.body.id === 'cc-atc-417')!.t;
    r.wait('cc-atc-real');
    const real = r.cues.find(c => c.body.kind === 'message' && c.body.id === 'cc-atc-real')!.t;
    expect(real - call).toBeGreaterThanOrEqual(11.9);
    expect(real - call).toBeLessThan(12.3);
    r.reply('cc-atc-real', 'cc-real-readback'); r.ctl('ap.alt', 14000); r.inSet(ES3); levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 3, 4]); // no reply to the call is a poor reply
  });

  it('reading back flight level 160 and setting 16000 is an uncorrected major error (grade 1); the flight still completes', () => {
    const r = mk(); late(r); callsign(r, { call: 'cc-readback-160', altitude: 16000 });
    r.inSet(ES3);
    expect(r.e.state.altitudeFt, 'Event Set 2 ended at its 30 s fallback, about 7,100 ft here (it was 9,000 ft or more at 250 ft/s, before the slower climb)').toBeGreaterThanOrEqual(7000);
    levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 1, 4]);
    expect(reasonText(r, ES2)).toContain('flight level 160, the level cleared for Corvane 417');
  });

  it('resetting 16000 to 14000 soon enough is a corrected major error (grade 2)', () => {
    const r = mk(); late(r); callsign(r, { call: 'cc-readback-160', altitude: 16000, fixTo14: true });
    r.inSet(ES3); levelOff(r);
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)[1]).toBe(2);
    expect(reasonText(r, ES2)).toContain('level cleared for Corvane 417');
  });

  it('climbing 300 ft or more through the stop altitude is a safety issue (grade 1) and the flight completes after the altitude is reset', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.until(() => r.e.state.altitudeFt >= 11350, 'the overshoot');
    r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013);
    r.reply('cc-atc-stop', 'cc-stop-readback'); r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.until(() => r.e.status.run !== 'running', 'the return to flight level 110');
    expect(r.e.status.endReason).toBe('completed');
    expect(r.e.state.altitudeFt).toBe(11000);
    expect(r.grade(ES3).grade).toBe(1);
    expect(reasonText(r, ES3)).toContain('more than 300 ft through the stop altitude');
    expect(grades(r).slice(0, 2)).toEqual([4, 4]);
  });

  it('a small overshoot below 300 ft is not a safety issue', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.until(() => r.e.state.altitudeFt >= 11100, 'a small overshoot');
    r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013);
    r.reply('cc-atc-stop', 'cc-stop-readback'); r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.until(() => r.e.status.run !== 'running', 'the end');
    expect(r.e.status.endReason).toBe('completed');
    expect(r.grade(ES3).reasons.map(x => x.text).join(' ')).not.toContain('300 ft');
  });

  it('telling the cabin to go ahead before the stop altitude is set is a minor prioritisation trap, corrected when the altitude is then set in time (grade 3)', () => {
    const r = mk(); toLevelOff(r); levelOff(r, { cabinFirst: true, cabinCard: 'cc-cabin-goahead' });
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 4, 3]);
    expect(reasonText(r, ES3)).toContain('asked to go ahead before the aircraft was set to stop');
  });

  it('answering the cabin "standby" before the stop altitude is set is the right priority, not an error (grade 4)', () => {
    const r = mk(); toLevelOff(r); levelOff(r, { cabinFirst: true, cabinCard: 'cc-cabin-standby' });
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 4, 4]);
  });

  it('answering the cabin first and setting the altitude only after the aircraft has passed it is uncorrected (grade 1 with the safety issue)', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.until(() => r.e.state.altitudeFt >= 11350, 'the overshoot');
    r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013); r.reply('cc-atc-stop', 'cc-stop-readback');
    r.until(() => r.e.status.run !== 'running', 'the end');
    expect(r.e.status.endReason).toBe('completed');
    expect(r.grade(ES3).grade).toBe(1);
  });

  it('a wrong stop read-back lowers the level-off set without blocking', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013);
    r.reply('cc-atc-stop', 'cc-stop-wrong'); r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.until(() => r.e.status.run !== 'running', 'the end');
    expect(r.e.status.endReason).toBe('completed');
    expect(grades(r)).toEqual([4, 4, 3]);
  });

  it('the standard setting is required: without 1013 the aircraft sits level, no level reminder is sent, and the flight times out at 140 s', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.ctl('ap.alt', 11000); r.reply('cc-atc-stop', 'cc-stop-readback'); r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.tick(60);
    expect(r.e.status.run).toBe('running');
    expect(r.e.state.altitudeFt).toBe(11000);
    r.until(() => r.e.status.run !== 'running', 'the timeout', 140);
    expect(r.e.status).toMatchObject({ run: 'ended', endReason: 'timeout' });
    expect(r.sent('cc-timeout-reminder')).toBe(false); // already level: the reminder is skipped
    expect(r.grade(ES3).grade).toBe(1);
    expect(reasonText(r, ES3)).toContain('standard 1013');
  });

  it('a pilot who is not level when the reminder is due gets the reminder at 120 s and its cards', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.until(() => r.sent('cc-timeout-reminder'), 'the reminder', 130);
    expect(r.e.status.tInSet).toBeGreaterThanOrEqual(119.9);
    r.reply('cc-timeout-reminder', 'cc-level-working');
    r.until(() => r.e.status.run !== 'running', 'the timeout', 140);
    expect(r.e.status.endReason).toBe('timeout');
  });

  it('an idle pilot reaches the debrief through the fallbacks with a timeout and no stuck Event Set', () => {
    const r = mk(); r.until(() => r.e.status.run !== 'running', 'the timeout', 400);
    expect(r.e.status.endReason).toBe('timeout');
    expect(grades(r)).toEqual([1, 1, 1]);
    expect(r.sent('cc-atc-real')).toBe(true);
    expect(r.sent('cc-atc-stop')).toBe(true);
  });

  it('the cabin call can be answered late: its cards stay on the comms panel, and answering 40 s later completes the flight', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    r.ctl('ap.alt', 11000); r.ctl('baro.set', 1013); r.reply('cc-atc-stop', 'cc-stop-readback');
    r.tick(40);
    expect(r.e.status.run).toBe('running');
    expect(r.sent('cc-cabin-callback'), 'no call-back without a standby').toBe(false);
    r.reply('cc-cabin-galley', 'cc-cabin-goahead');
    r.until(() => r.e.status.run !== 'running', 'the end');
    expect(r.e.status.endReason).toBe('completed');
  });

  it('after "go ahead" the cabin reports once and never calls back', () => {
    const r = mk(); toLevelOff(r); levelOff(r, { cabinCard: 'cc-cabin-goahead' });
    expect(r.e.status.endReason).toBe('completed');
    expect(r.sent('cc-cabin-report')).toBe(true);
    expect(r.sent('cc-cabin-callback')).toBe(false);
  });

  it('can redo the level-off set from its snapshot', () => {
    const r = mk(); toLevelOff(r); levelOff(r);
    r.s.redo(ES3);
    expect(r.e.firedFor(ES3).size).toBe(0);
    expect(r.e.state.altitudeFt).toBeLessThan(11000);
    r.until(() => r.sent('cc-atc-stop') && r.comms.pendingCards().some(c => c.messageId === 'cc-atc-stop'), 'the stop call again');
  });
});

describe('Cross-Check timing', () => {
  const cueT = (r: Run, id: string) => r.cues.find(c => c.body.kind === 'message' && c.body.id === id)!.t;
  const setStartT = (r: Run, id: string) => r.cues.find(c => c.body.kind === 'eventSet' && c.body.eventSetId === id && c.body.status === 'start')!.t;
  /** Real seconds from the stop call until the aircraft first reaches `ft` with no input (the autopilot target stays at 14000). */
  const secondsToReach = (r: Run, ft: number) => {
    const t0 = r.e.state.altitudeFt; void t0;
    let elapsed = 0;
    while (r.e.state.altitudeFt < ft && elapsed < 120) { r.e.tick(0.1); elapsed += 0.1; }
    expect(r.e.state.altitudeFt).toBeGreaterThanOrEqual(ft);
    return elapsed;
  };
  /**
   * The worst Event Set 2 a pilot can fly: the aircraft climbs unrestricted from the start (14000 set at once), the call for the other
   * flight is never answered (so the real clearance comes at the latest moment, 12 s after the call, at about 4,500 ft) and the real
   * clearance is never read back, so the set ends only through the 30 s fallback or the 8,500 ft cap, whichever is first.
   * `scenario` may be a variant without the 30 s fallback, which lets the cap alone end the set (nothing else can reach it).
   */
  function worstEventSet2(scenario: Scenario = crossCheck) {
    const r = mk(scenario); late(r); climb(r); r.ctl('ap.alt', 14000); r.reply('cc-dep-contact', 'cc-dep-readback');
    r.wait('cc-atc-real');
    const realT = cueT(r, 'cc-atc-real');
    const realAlt = r.e.state.altitudeFt;
    r.inSet(ES3);
    r.wait('cc-atc-stop');
    return { r, realT, realAlt };
  }
  /** Cross-Check with only the 8,500 ft cap (and the read-back route) ending Event Set 2. */
  function capOnly(): Scenario {
    const c = structuredClone(crossCheck);
    const es2 = c.eventSets[1];
    if (es2.endWhen.kind !== 'any') throw new Error('Event Set 2 endWhen changed shape');
    es2.endWhen = { kind: 'any', of: es2.endWhen.of.filter(w => w.kind !== 'ruleFired' || w.afterSec === undefined) };
    expect(es2.endWhen.of).toHaveLength(2);
    return parseScenario(c);
  }

  it('worst case: Event Set 2 ending at its 30 s fallback leaves 24.3 s (measured; at least 18 s required) between the stop call and 11,300 ft', () => {
    const { r, realAlt } = worstEventSet2();
    const callAlt = r.e.state.altitudeFt;
    expect(callAlt).toBeGreaterThan(6000);
    expect(callAlt).toBeLessThanOrEqual(8500);
    const to11000 = secondsToReach(r, 11000);
    const toLimit = to11000 + secondsToReach(r, 11300);
    // eslint-disable-next-line no-console
    console.log(`Cross-Check worst case (30 s fallback): real clearance at ${realAlt.toFixed(0)} ft, stop call at ${callAlt.toFixed(0)} ft, ${to11000.toFixed(1)} s to 11,000 ft, ${toLimit.toFixed(1)} s to 11,300 ft`);
    expect(toLimit).toBeGreaterThanOrEqual(18);
    expect(toLimit).toBeLessThanOrEqual(26);
  });

  it('worst case at the 8,500 ft cap itself (the 30 s fallback removed): 22.3 s (measured; at least 18 s required) to 11,300 ft and 19.9 s to 11,000 ft', () => {
    const { r } = worstEventSet2(capOnly());
    const callAlt = r.e.state.altitudeFt;
    expect(callAlt, 'Event Set 2 ended at its cap').toBeGreaterThanOrEqual(8500);
    expect(callAlt).toBeLessThan(8520);
    const to11000 = secondsToReach(r, 11000);
    const toLimit = to11000 + secondsToReach(r, 11300);
    // eslint-disable-next-line no-console
    console.log(`Cross-Check worst case (8,500 ft cap): stop call at ${callAlt.toFixed(0)} ft, ${to11000.toFixed(1)} s to 11,000 ft, ${toLimit.toFixed(1)} s to 11,300 ft`);
    expect(toLimit).toBeGreaterThanOrEqual(18);
    expect(toLimit).toBeLessThanOrEqual(23);
    expect(to11000).toBeGreaterThanOrEqual(19.5);
  });

  it('typical case: on the best path the stop call (passing 6,000 ft) leaves 40.0 s (measured) before flight level 110', () => {
    const r = mk(); toLevelOff(r); r.wait('cc-atc-stop');
    expect(r.e.state.altitudeFt).toBeGreaterThanOrEqual(6000);
    expect(r.e.state.altitudeFt).toBeLessThan(6020);
    const to11000 = secondsToReach(r, 11000);
    // eslint-disable-next-line no-console
    console.log(`Cross-Check typical case: stop call passing 6,000 ft, ${to11000.toFixed(1)} s to 11,000 ft`);
    expect(to11000).toBeGreaterThanOrEqual(39);
    expect(to11000).toBeLessThanOrEqual(41);
  });

  it('Event Set 2 budget: from the real clearance to the end of the set there are at least 25 real seconds (30.0 s measured), and the cap alone gives 32 s from the latest clearance', () => {
    const { r, realT, realAlt } = worstEventSet2();
    const budget = setStartT(r, ES3) - realT;
    const { r: c, realT: cRealT, realAlt: cRealAlt } = worstEventSet2(capOnly());
    const capBudget = setStartT(c, ES3) - cRealT;
    // eslint-disable-next-line no-console
    console.log(`Cross-Check Event Set 2 budget: ${budget.toFixed(1)} s from the real clearance (at ${realAlt.toFixed(0)} ft); cap alone ${capBudget.toFixed(1)} s (from ${cRealAlt.toFixed(0)} ft)`);
    expect(realAlt, 'the latest real clearance comes below 5,000 ft').toBeLessThanOrEqual(5000);
    expect(budget).toBeGreaterThanOrEqual(25);
    expect(capBudget).toBeGreaterThanOrEqual(25);
    // The same budget measured from a clearance arriving at the full 5,000 ft the autopilot was set to: (8,500 - 5,000) / 125 = 28 s.
    expect((8500 - 5000) / 125).toBeGreaterThanOrEqual(25);
  });

  it('keeps the same margin in patience mode (aircraft motion stays at real pace)', () => {
    const r = mk(); r.s.setPatience(2); toLevelOff(r); r.wait('cc-atc-stop');
    let elapsedReal = 0;
    while (r.e.state.altitudeFt < 11000 && elapsedReal < 120) { r.e.tick(0.1); elapsedReal += 0.1; }
    expect(elapsedReal).toBeGreaterThanOrEqual(39);
  });

  it('the overshoot path (flight level 140 reached, then 11000 set, baro and the cabin answered) completes, with the safety issue, 20 s or more before the timeout', () => {
    const r = mk(); late(r); climb(r); r.reply('cc-dep-contact', 'cc-dep-readback');
    r.wait('cc-atc-417'); r.reply('cc-atc-417', 'cc-not-ours'); // the real clearance comes at once: the earliest, lowest Event Set 3 start
    r.wait('cc-atc-real'); r.reply('cc-atc-real', 'cc-real-readback'); r.ctl('ap.alt', 14000);
    r.inSet(ES3);
    const es3T = setStartT(r, ES3);
    r.wait('cc-atc-stop');
    r.ctl('baro.set', 1013); r.reply('cc-atc-stop', 'cc-stop-readback'); r.reply('cc-cabin-galley', 'cc-cabin-standby'); // done on the way up
    r.until(() => r.e.state.altitudeFt >= 14000, 'the full flight level 140');
    r.ctl('ap.alt', 11000);
    r.wait('cc-cabin-callback'); r.reply('cc-cabin-callback', 'cc-callback-go');
    r.until(() => r.e.status.run !== 'running', 'the return to flight level 110');
    const doneAt = r.e.status.tInSet;
    // eslint-disable-next-line no-console
    console.log(`Cross-Check overshoot path: stop call ${(cueT(r, 'cc-atc-stop') - es3T).toFixed(1)} s into the set, completed ${doneAt.toFixed(1)} s into the set; reminder ${crossCheck.softTimeout.promptAtSec} s, timeout ${crossCheck.softTimeout.afterSec} s`);
    expect(r.e.status).toMatchObject({ run: 'ended', endReason: 'completed' });
    expect(r.e.state.altitudeFt).toBe(11000);
    expect(r.sent('cc-timeout-reminder'), 'completed before the reminder').toBe(false);
    expect(crossCheck.softTimeout.afterSec - doneAt).toBeGreaterThanOrEqual(20);
    expect(r.grade(ES3).grade).toBe(1);
    expect(reasonText(r, ES3)).toContain('more than 300 ft through the stop altitude');
  });
});

// ---------------------------------------------------------------------------
// No dead ends (lesson of T43). Every combination of reply cards, competent control inputs.
interface Decision { key: string; n: number }
interface Outcome { endReason: string | undefined; run: string; simSec: number; decisions: Decision[]; choices: number[]; grades: number[]; cabinAnswered: boolean; messages: string[] }

/**
 * One scripted run. `choices[i]` picks the i-th offered message's card (the last index = no reply); positions past the
 * prefix default to 0. Controls are a competent pilot's: each is set a fixed reaction time after the cue that asks for it.
 */
function drive(prefix: number[], opts: { controls: boolean; replies: boolean }): Outcome {
  const s = new TrainingSession(crossCheck, { mode: 'auto' });
  const comms = new CommsModel();
  const e = s.engine;
  const decisions: Decision[] = [];
  const choices: number[] = [];
  const tasks: { at: number; fn: () => void }[] = [];
  const messages: string[] = [];
  let now = 0;
  let cabinAnswered = false;
  const ctl = (controlId: ControlId, value: number | boolean | string) => e.dispatch({ kind: 'control', controlId, value });
  const later = (delay: number, fn: () => void) => tasks.push({ at: now + delay, fn });
  const onCue = (body: WorldCue) => {
    comms.apply(body);
    if (body.kind === 'message') {
      messages.push(body.id);
      if (opts.replies && body.cards?.length) {
        const i = decisions.length;
        const n = body.cards.length + 1;
        const pick = i < prefix.length ? prefix[i] : 0;
        decisions.push({ key: body.id, n });
        choices.push(pick);
        if (pick < body.cards.length) {
          const card = body.cards[pick].id;
          later(2, () => {
            const a = comms.choose(body.id, card);
            if (a) e.dispatch(a);
          });
          if ((body.id === 'cc-cabin-galley' && card === 'cc-cabin-goahead') || body.id === 'cc-cabin-callback') cabinAnswered = true;
        }
      }
      if (opts.controls && body.id === 'cc-atc-real') later(2, () => ctl('ap.alt', 14000));
      if (opts.controls && body.id === 'cc-atc-stop') { later(2, () => ctl('ap.alt', 11000)); later(3, () => ctl('baro.set', 1013)); }
    }
    if (opts.controls && body.kind === 'eventSet' && body.status === 'start') {
      if (body.eventSetId === 'cc-es1-late-change') {
        later(2, () => ctl('ap.alt', 5000)); later(2.5, () => ctl('ap.hdg', 240)); later(3, () => ctl('baro.set', 1008));
        crossCheck.checklists[0].items.forEach((it, k) => later(3.5 + k * 0.5, () => e.dispatch({ kind: 'checklistItem', checklistId: 'cc-amended', itemId: it.id })));
      }
      if (body.eventSetId === 'cc-es2-similar-callsign') { later(2, () => ctl('ap.engage', true)); later(2.5, () => ctl('ap.vertical', 'climb')); }
    }
  };
  s.onCue(c => onCue(c.body));
  s.start();
  const dt = 0.5;
  while (e.status.run === 'running' && now < 600) {
    now += dt;
    e.tick(dt);
    for (const t of tasks.filter(x => x.at <= now + 1e-9)) { tasks.splice(tasks.indexOf(t), 1); if (e.status.run === 'running') t.fn(); }
  }
  return { endReason: e.status.endReason, run: e.status.run, simSec: now, decisions, choices, grades: s.results().original.map(g => g.grade), cabinAnswered, messages };
}

describe('Cross-Check has no dead ends', () => {
  it('every combination of reply cards (including no reply) with competent controls ends completed, or timeout when the cabin is never answered', () => {
    const started = performance.now();
    const stack: number[][] = [[]];
    let runs = 0, completed = 0, timedOut = 0, maxSim = 0;
    const decisionKeys = new Set<string>();
    while (stack.length) {
      const prefix = stack.pop()!;
      const o = drive(prefix, { controls: true, replies: true });
      runs++;
      maxSim = Math.max(maxSim, o.simSec);
      const label = `${o.decisions.map((d, i) => `${d.key}:${o.choices[i]}`).join(' ')}`;
      expect(o.run, label).toBe('ended');
      expect(o.endReason, label).toBe(o.cabinAnswered ? 'completed' : 'timeout');
      expect(o.simSec, label).toBeLessThan(290); // was 260 before Event Set 3's timeout moved from 80 s to 140 s (longest run now 262.5 s)
      expect(o.grades, label).toHaveLength(3);
      for (const g of o.grades) expect(g).toBeGreaterThanOrEqual(1);
      // Rules are once-only: no message is ever sent twice.
      expect(new Set(o.messages).size, label).toBe(o.messages.length);
      for (const d of o.decisions) decisionKeys.add(d.key);
      if (o.endReason === 'completed') completed++; else timedOut++;
      for (let i = prefix.length; i < o.decisions.length; i++)
        for (let v = 1; v < o.decisions[i].n; v++) stack.push([...o.choices.slice(0, i), v]);
    }
    const seconds = (performance.now() - started) / 1000;
    // Every message that offers cards took part, and the number of runs is the exhaustive count of reachable reply combinations.
    const offering = messagesOf().filter(m => m.cards?.length).map(m => m.id);
    expect([...decisionKeys].sort()).toEqual([...offering].sort().filter(id => id !== 'cc-timeout-reminder'));
    expect(completed + timedOut).toBe(runs);
    expect(timedOut).toBeGreaterThan(0);
    expect(completed).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`Cross-Check no-dead-end: ${runs} runs (${completed} completed, ${timedOut} timeout with the cabin never answered), longest ${maxSim.toFixed(1)} s, ${seconds.toFixed(1)} s wall`);
    expect(seconds).toBeLessThan(25);
  }, 60000);

  it('with no control inputs and no replies at all the run ends timeout; nothing stays running', () => {
    const o = drive([], { controls: false, replies: false });
    expect(o).toMatchObject({ run: 'ended', endReason: 'timeout' });
    expect(o.simSec).toBeLessThan(290); // was 260 before Event Set 3's timeout moved from 80 s to 140 s (this run takes 267 s)
    expect(o.grades).toEqual([1, 1, 1]);
  });

  it('with competent controls but no replies at all the run ends timeout (the cabin call needs one answer)', () => {
    const o = drive([], { controls: true, replies: false });
    expect(o).toMatchObject({ run: 'ended', endReason: 'timeout' });
  });

  it('with replies but no control inputs the run still ends (timeout) and never hangs', () => {
    const stack: number[][] = [[]];
    let runs = 0;
    while (stack.length && runs < 400) {
      const prefix = stack.pop()!;
      const o = drive(prefix, { controls: false, replies: true });
      runs++;
      expect(o.run).toBe('ended');
      expect(o.endReason).toBe('timeout');
      for (let i = prefix.length; i < o.decisions.length; i++)
        for (let v = 1; v < o.decisions[i].n; v++) stack.push([...o.choices.slice(0, i), v]);
    }
    expect(runs).toBeGreaterThan(20);
  }, 60000);
});
