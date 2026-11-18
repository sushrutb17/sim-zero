import { describe, expect, it } from 'vitest';
import { parseScenario } from '../../src/contracts/scenario';
import type { EventSetGrade, PilotAction, Stamped, WorldCue } from '../../src/contracts/events';
import type { ControlId } from '../../src/contracts/aircraft';
import { TrainingSession } from '../../src/engine/session';
import { timeCritical } from '../../src/scenarios/time-critical';
import { allScenarios, flightById } from '../../src/scenarios/registry';
import { singleSource } from '../../src/scenarios/single-source';
import { CommsModel } from '../../src/xr/panels/panelModel';

const cuesOf = () => [timeCritical.softTimeout.promptCue, ...timeCritical.eventSets.flatMap(es => [...es.startCues, ...es.rules.flatMap(r => r.cues)])];

describe('Time Critical content', () => {
  it('passes the frozen contract with three Event Sets, three hints each and both checklists', () => {
    expect(parseScenario(structuredClone(timeCritical))).toEqual(timeCritical);
    expect(timeCritical).toMatchObject({ id: 'time-critical', title: 'Time Critical' });
    expect(timeCritical.notice).toContain('Voices are computer-generated.');
    expect(timeCritical.eventSets.map(es => es.id)).toEqual(['tc-es1-cruise', 'tc-es2-cabin-call', 'tc-es3-decision']);
    for (const es of timeCritical.eventSets) expect(es.hints).toHaveLength(3);
    expect(timeCritical.checklists.map(c => c.title)).toEqual(['CRUISE', 'DIVERSION']);
    expect(timeCritical.softTimeout.eventSetId).toBe('tc-es3-decision');
    expect(timeCritical.endConditions.map(e => e.reason)).toEqual(['diversionSetUp', 'continueConfirmed']);
  });

  it('starts level in cruise with no failure, storm or subsequent failure patch', () => {
    expect(timeCritical.initialAircraft).toMatchObject({ phase: 'cruise', altitudeFt: 26000, stormBearingDeg: null,
      ap: { engaged: true, alt: 26000, vertical: 'hold' },
      elec: { gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false }, backupGenInop: false } });
    for (const c of cuesOf()) if (c.kind === 'aircraft') {
      expect(c.patch.elec).toBeUndefined();
      expect(c.patch.altitudeFt).toBeUndefined();
      expect(c.patch.ap).toBeUndefined();
    }
  });

  it('uses only ASCII text, original airport names and unique tc- message ids, each voiced only by its own clip', () => {
    expect(JSON.stringify(timeCritical)).toMatch(/^[\x20-\x7E]+$/);
    for (const a of timeCritical.airports) expect(singleSource.airports.map(a => a.name)).not.toContain(a.name);
    const messages = cuesOf().filter((c): c is Extract<WorldCue, { kind: 'message' }> => c.kind === 'message');
    expect(new Set(messages.map(c => c.id)).size).toBe(messages.length);
    // T45: the clips exist now. Which ids are voiced is checked in voice.test.ts; here only that a clip path is the id's own.
    for (const c of messages) { expect(c.id).toMatch(/^tc-/); if (c.audio !== undefined) expect(c.audio, c.id).toBe(`/audio/voice/${c.id}.mp3`); }
    const ids = new Set<string>();
    const text = new Map<string, string>();
    for (const sc of allScenarios()) for (const es of sc.eventSets) for (const c of [...es.startCues, ...es.rules.flatMap(r => r.cues)]) {
      if (c.kind !== 'message') continue;
      if (text.has(c.id)) expect(text.get(c.id)).toBe(c.text);
      text.set(c.id, c.text);
      if (sc.id === 'single-source') ids.add(c.id);
    }
    for (const m of messages) expect(ids.has(m.id)).toBe(false);
  });

  it('offers real reply choices on every reply message and keeps the early commitment neutral', () => {
    for (const c of cuesOf()) if (c.kind === 'message' && c.cards?.length) {
      expect(c.cards.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.cards.length, c.id).toBeLessThanOrEqual(4);
    }
    const initialCall = cuesOf().find(c => c.kind === 'message' && c.id === 'tc-cabin-collapse');
    const early = initialCall?.kind === 'message' && initialCall.cards?.find(c => c.id === 'tc-commit-early');
    expect(early && early.text).toBe('We will divert to the nearest suitable airport. Stand by with the passenger details.');
  });

  it('gives every recovery prompt exactly two advancing cards with an exact comm quality map', () => {
    const ids = ['tc-condition-clarify', 'tc-attending-clarify', 'tc-doctor-clarify', 'tc-dispatch-clarify-large', 'tc-dispatch-clarify-near'];
    for (const id of ids) {
      const message = cuesOf().find(c => c.kind === 'message' && c.id === id);
      expect(message?.kind).toBe('message');
      if (message?.kind !== 'message') continue;
      expect(message.cards).toHaveLength(2);
      const checks = timeCritical.eventSets.flatMap(es => es.checks).filter(c => c.kind === 'comm' && c.messageId === id);
      expect(checks).toHaveLength(1);
      const check = checks[0];
      if (check.kind !== 'comm') continue;
      expect(Object.keys(check.quality).sort()).toEqual(message.cards!.map(c => c.id).sort());
      expect(Object.values(check.quality)).toEqual(['good', 'acceptable']);
      expect(check.reason).toBe('The clarification was not answered.');
    }
    const brief = cuesOf().find(c => c.kind === 'message' && c.id === 'tc-cabin-brief');
    expect(brief?.kind === 'message' && brief.cards?.find(c => c.id === 'tc-cabin-clear')?.text).not.toContain('agreed with ATC and dispatch');
  });

  it.each([-1, 1, 0.5, NaN, Infinity, -Infinity])('rejects invalid Time Critical variation index %s', index => {
    expect(() => flightById('time-critical')!.build(index)).toThrow(RangeError);
  });

  it('registers one unguided seven-minute flight', () => {
    const f = flightById('time-critical');
    expect(f).toMatchObject({ id: 'time-critical', title: 'Time Critical', blurb: 'A passenger collapses in cruise', minutes: 7, guided: false, variations: 1 });
    expect(f?.build(0)).toBe(timeCritical);
  });
});

// Drive only reachable messages/cards and opened checklist lines, like the cockpit would.
function mk() {
  const s = new TrainingSession(timeCritical, { mode: 'auto' });
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
    expect(timeCritical.checklists.find(c => c.id === checklistId)?.items.map(i => i.id)).toContain(itemId);
    act({ kind: 'checklistItem', checklistId, itemId });
  };
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
  };
  const until = (predicate: () => boolean, what: string, maxSec = 240) => {
    let t = 0;
    while (!predicate()) {
      if (t > maxSec || e.status.run !== 'running') throw new Error(`Waiting for ${what}: ${JSON.stringify(e.status)}`);
      e.tick(0.1); t += 0.1;
    }
  };
  const inSet = (id: string) => until(() => e.status.eventSetId === id, id);
  const grade = (id: string): EventSetGrade => {
    const g = s.results().original.find(g => g.eventSetId === id);
    if (!g) throw new Error(`Missing grade ${id}`);
    return g;
  };
  return { s, e, cues, comms, act, ctl, reply, item, tick, until, inSet, grade };
}
type Run = ReturnType<typeof mk>;

function cruise(r: Run) {
  r.tick(4);
  r.reply('tc-frequency', 'tc-frequency-readback');
  for (const id of ['tc-cr-autopilot', 'tc-cr-frequency', 'tc-cr-route']) r.item('tc-cruise', id);
  r.inSet('tc-es2-cabin-call');
}
function cabin(r: Run, opts: { early?: boolean; skipHeading?: boolean; recoverHeading?: boolean } = {}) {
  r.reply('tc-traffic', 'tc-traffic-readback');
  if (!opts.skipHeading) { r.ctl('ap.hdg', 110); r.tick(3); }
  if (opts.early) {
    r.reply('tc-cabin-collapse', 'tc-commit-early');
    r.tick(2);
    r.reply('tc-cabin-recheck', 'tc-ask-condition');
  } else r.reply('tc-cabin-collapse', 'tc-ask-condition');
  if (opts.recoverHeading) { r.ctl('ap.hdg', 110); r.tick(3); }
  r.tick(2);
  r.reply('tc-condition-report', 'tc-ask-attending');
  r.tick(2);
  r.reply('tc-attending-report', 'tc-ask-doctor');
  r.inSet('tc-es3-decision');
}
function toDecision(opts: Parameters<typeof cabin>[1] = {}) {
  const r = mk(); cruise(r); cabin(r, opts); return r;
}
function checklist(r: Run) {
  for (const id of ['tc-dv-condition', 'tc-dv-clearance', 'tc-dv-dispatch', 'tc-dv-cabin']) r.item('tc-diversion', id);
}
function brief(r: Run, card = 'tc-cabin-clear') {
  r.ctl('pa.cabin', true);
  r.reply('tc-cabin-brief', card);
}
function divert(r: Run, side: 'large' | 'near' = 'large', message = 'tc-intentions') {
  r.reply(message, `tc-divert-${side}`);
  r.ctl('route.destination', `tc-${side}`);
  r.ctl('ap.hdg', side === 'large' ? 70 : 150);
  r.tick(4);
  r.reply(`tc-dispatch-${side}`, 'tc-dispatch-informed');
  checklist(r);
  brief(r);
}

const grades = (r: Run) => r.s.results().original.map(g => g.grade);

describe('Time Critical fly-throughs', () => {
  it('best airport reaches diversionSetUp with 4, 4, 4 and no system failure or altitude change', () => {
    const r = toDecision(); divert(r);
    expect(r.e.status).toMatchObject({ run: 'ended', endReason: 'diversionSetUp' });
    expect(grades(r)).toEqual([4, 4, 4]);
    expect(r.e.state).toMatchObject({ destination: 'tc-large', altitudeFt: 26000, headingDeg: 70,
      elec: { gen1: { failed: false, switchOn: true }, gen2: { failed: false, switchOn: true } } });
    expect(r.cues.filter(c => c.body.kind === 'message' && c.body.channel === 'crew').map(c => c.body.kind === 'message' && c.body.id))
      .toEqual(['tc-crew-cruise', 'tc-crew-traffic', 'tc-crew-route']);
  });

  it('nearest airport is accepted but grades down only the decision set with the risk reason', () => {
    const r = toDecision(); divert(r, 'near');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(r.e.state.destination).toBe('tc-near');
    expect(grades(r)).toEqual([4, 4, 2]);
    expect(r.grade('tc-es3-decision').reasons).toEqual([{ category: 'crm', text: expect.stringMatching(/short wet runway.*near-limit crosswind/) }]);
  });

  it('confirmed continue after one concern reaches continueConfirmed, decision grade 1 with the safety reason', () => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-continue'); r.tick(10);
    expect(r.e.status.run).toBe('running');
    r.reply('tc-continue-concern', 'tc-confirm-continue'); r.tick(10);
    expect(r.e.status.run).toBe('running'); // Cabin still needs the plan.
    brief(r);
    expect(r.e.status.endReason).toBe('continueConfirmed');
    expect(grades(r)).toEqual([4, 4, 1]);
    expect(r.grade('tc-es3-decision').reasons[0].text).toMatch(/Continuing was confirmed.*within the hour.*1 hour 40/);
    expect(r.cues.filter(c => c.body.kind === 'message' && c.body.id === 'tc-continue-concern')).toHaveLength(1);
  });

  it('continue can be reconsidered after the concern and still achieve the top grade', () => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-continue');
    divert(r, 'large', 'tc-continue-concern');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(grades(r)).toEqual([4, 4, 4]);
  });

  it('early commitment is a corrected minor trap once condition is requested', () => {
    const r = toDecision({ early: true }); divert(r);
    expect(grades(r)).toEqual([4, 3, 4]);
    expect(r.grade('tc-es2-cabin-call').reasons).toEqual([{ category: 'crm', text: expect.stringMatching(/committed to before asking/) }]);
    const actions = r.e.actionsFor('tc-es2-cabin-call');
    const early = actions.find(a => a.body.kind === 'reply' && a.body.cardId === 'tc-commit-early')!;
    const asked = actions.find(a => a.body.kind === 'reply' && a.body.cardId === 'tc-ask-condition')!;
    expect(early.seq).toBeLessThan(asked.seq);
  });

  it('leaving the traffic heading unset while talking is an uncorrected minor trap, grade 2', () => {
    const r = toDecision({ skipHeading: true });
    expect(r.e.snapshotAt('tc-es3-decision').state.ap.hdg).toBe(90);
    divert(r);
    expect(grades(r)).toEqual([4, 2, 4]);
    expect(r.grade('tc-es2-cabin-call').reasons).toEqual([{ category: 'automation', text: expect.stringMatching(/heading was left unset/) }]);
  });

  it('setting the traffic heading after starting the cabin conversation corrects that minor trap', () => {
    const r = toDecision({ skipHeading: true, recoverHeading: true }); divert(r);
    expect(grades(r)).toEqual([4, 3, 4]);
    expect(r.grade('tc-es2-cabin-call').reasons[0].text).toMatch(/heading was left unset/);
  });

  it.each(['route', 'heading', 'autopilot', 'level', 'cabin'] as const)('diversion cannot end with %s missing, then ends when corrected', missing => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-divert-large');
    if (missing !== 'route') r.ctl('route.destination', 'tc-large');
    if (missing !== 'heading') r.ctl('ap.hdg', 70);
    if (missing === 'autopilot') r.ctl('ap.engage', false);
    if (missing === 'level') r.ctl('ap.vertical', 'climb');
    r.tick(4);
    r.reply('tc-dispatch-large', 'tc-dispatch-informed'); checklist(r);
    if (missing !== 'cabin') brief(r);
    expect(r.e.status.run).toBe('running');
    if (missing === 'route') r.ctl('route.destination', 'tc-large');
    if (missing === 'heading') r.ctl('ap.hdg', 70);
    if (missing === 'autopilot') r.ctl('ap.engage', true);
    if (missing === 'level') r.ctl('ap.vertical', 'hold');
    if (missing === 'cabin') brief(r);
    r.tick(4);
    expect(r.e.status.endReason).toBe('diversionSetUp');
  });

  it('setting the near route/heading after requesting the large airport cannot complete the wrong diversion', () => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-divert-large');
    r.ctl('route.destination', 'tc-near'); r.ctl('ap.hdg', 150); r.tick(4);
    r.reply('tc-dispatch-large', 'tc-dispatch-informed'); checklist(r); brief(r);
    expect(r.e.status.run).toBe('running');
    r.ctl('route.destination', 'tc-large'); r.ctl('ap.hdg', 70); r.tick(6);
    expect(r.e.status.endReason).toBe('diversionSetUp');
  });

  it.each(['dispatch', 'checklist', 'both'] as const)('missing %s waits for timeout and lowers the decision grade', missing => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-divert-large');
    r.ctl('route.destination', 'tc-large'); r.ctl('ap.hdg', 70); r.tick(4); brief(r);
    expect(r.e.status.run).toBe('running');
    if (missing === 'checklist') r.reply('tc-dispatch-large', 'tc-dispatch-informed');
    if (missing === 'dispatch') checklist(r);
    expect(r.e.status.run).toBe('running');
    r.tick(177);
    expect(r.e.status.endReason).toBe('timeout');
    expect(grades(r)).toEqual([4, 4, 1]);
    const reasons = r.grade('tc-es3-decision').reasons.map(x => x.text).join(' ');
    if (missing !== 'checklist') expect(reasons).toContain('Dispatch was not informed');
    if (missing !== 'dispatch') expect(reasons).toContain('diversion checklist was not completed');
    // The setup check stays independent of dispatch/checklist completion.
    expect(reasons).not.toContain('route, cleared heading and cabin briefing were not completed');
  });

  it.each(['dispatch', 'checklist'] as const)('cabin-first briefing still reaches 4, 4, 4 when %s is completed last', last => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-divert-large');
    brief(r); // The cabin asks for the plan before route/heading are set.
    expect(r.e.status.run).toBe('running');
    r.ctl('route.destination', 'tc-large'); r.ctl('ap.hdg', 70); r.tick(4);
    expect(r.e.status.run).toBe('running');
    if (last === 'dispatch') checklist(r);
    else r.reply('tc-dispatch-large', 'tc-dispatch-informed');
    expect(r.e.status.run).toBe('running');
    if (last === 'dispatch') r.reply('tc-dispatch-large', 'tc-dispatch-informed');
    else checklist(r);
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(grades(r)).toEqual([4, 4, 4]);
  });

  it.each(['tc-traffic-wrong', 'tc-traffic-vague'])('a poor traffic reply %s lowers the cabin set without blocking fact gathering', card => {
    const r = mk(); cruise(r);
    r.reply('tc-traffic', card); r.ctl('ap.hdg', 110); r.tick(3);
    r.reply('tc-cabin-collapse', 'tc-ask-condition');
    r.reply('tc-condition-report', 'tc-ask-attending');
    r.reply('tc-attending-report', 'tc-ask-doctor');
    r.inSet('tc-es3-decision'); divert(r);
    expect(grades(r)).toEqual([4, 3, 4]);
    expect(r.grade('tc-es2-cabin-call').reasons[0].text).toContain('not read back');
  });

  it.each([
    ['condition', 'tc-condition-clarify', 'tc-ask-condition', 'tc-condition-summary'],
    ['attending', 'tc-attending-clarify', 'tc-ask-attending', 'tc-attending-summary'],
    ['doctor', 'tc-doctor-clarify', 'tc-ask-doctor', 'tc-doctor-summary'],
  ].flatMap(([fact, message, good, weak]) => [good, weak].map(card => ({ fact, message, card }))))(
    'a vague $fact question recovers via $message / $card without the fallback wait', ({ fact, message, card }) => {
      const r = mk(); cruise(r);
      r.reply('tc-traffic', 'tc-traffic-readback'); r.ctl('ap.hdg', 110); r.tick(3);
      if (fact === 'condition') {
        r.reply('tc-cabin-collapse', 'tc-commit-early'); r.reply('tc-cabin-recheck', 'tc-condition-vague');
        r.reply(message, card);
      } else r.reply('tc-cabin-collapse', 'tc-ask-condition');
      if (fact === 'attending') {
        r.reply('tc-condition-report', 'tc-attending-vague'); r.reply(message, card);
      } else r.reply('tc-condition-report', 'tc-ask-attending');
      if (fact === 'doctor') {
        r.reply('tc-attending-report', 'tc-doctor-vague'); r.reply(message, card);
      } else r.reply('tc-attending-report', 'tc-ask-doctor');
      r.until(() => r.e.status.eventSetId === 'tc-es3-decision', 'recovered cabin questions', 20);
      divert(r);
      expect(r.e.status.endReason).toBe('diversionSetUp');
      expect(grades(r)).toEqual([4, 3, 4]);
      const reasons = r.grade('tc-es2-cabin-call').reasons.map(x => x.text).join(' ');
      expect(reasons).toContain(fact === 'condition' ? 'did not clearly ask' : fact === 'attending' ? 'did not establish' : 'did not ask about a doctor');
      expect(reasons).not.toMatch(/not requested|not established|not checked/);
      expect(r.cues.filter(c => c.body.kind === 'message' && c.body.id === message)).toHaveLength(1);
    });

  it.each((['large', 'near'] as const).flatMap(side => ['tc-dispatch-informed', 'tc-dispatch-brief'].map(card => ({ side, card }))))(
    'a vague dispatch reply for $side recovers via $card without the timeout wait', ({ side, card }) => {
      const r = toDecision(); r.reply('tc-intentions', `tc-divert-${side}`);
      r.ctl('route.destination', `tc-${side}`); r.ctl('ap.hdg', side === 'large' ? 70 : 150); r.tick(4);
      brief(r); checklist(r); r.reply(`tc-dispatch-${side}`, 'tc-dispatch-vague');
      expect(r.e.status.run).toBe('running');
      r.reply(`tc-dispatch-clarify-${side}`, card);
      expect(r.e.status.endReason).toBe('diversionSetUp');
      expect(grades(r)).toEqual([4, 4, side === 'large' ? 3 : 2]);
      const reasons = r.grade('tc-es3-decision').reasons.map(x => x.text).join(' ');
      expect(reasons).toContain('dispatch reply did not confirm');
      expect(reasons).not.toContain('Dispatch was not informed');
      expect(r.cues.filter(c => c.body.kind === 'message' && c.body.id === `tc-dispatch-clarify-${side}`)).toHaveLength(1);
      expect(r.cues.some(c => c.body.kind === 'message' && c.body.id === 'tc-dispatch-ack')).toBe(true);
    });

  it('the reminder still offers the decisions and the best path works from it', () => {
    const r = toDecision(); r.tick(121); divert(r, 'large', 'tc-timeout-reminder');
    expect(r.e.status.endReason).toBe('diversionSetUp');
    expect(grades(r)).toEqual([4, 4, 3]); // Decision outside 110 s + 10 s grace.
  });

  it.each(['tc-divert-large', 'tc-divert-near', 'tc-confirm-continue'])(
    'an unanswered continue concern keeps all cards past 120 s and completes via %s', card => {
      const r = toDecision();
      r.reply('tc-intentions', 'tc-continue');
      r.tick(121);
      expect(r.e.status.run).toBe('running');
      expect(r.cues.some(c => c.body.kind === 'message' && c.body.id === 'tc-timeout-reminder')).toBe(false);
      expect(r.comms.pendingCards().filter(c => c.messageId === 'tc-continue-concern').map(c => c.cardId))
        .toEqual(['tc-divert-large', 'tc-divert-near', 'tc-confirm-continue']);
      if (card === 'tc-confirm-continue') {
        r.reply('tc-continue-concern', card);
        brief(r);
        expect(r.e.status.endReason).toBe('continueConfirmed');
        expect(grades(r)).toEqual([4, 4, 1]);
        expect(r.grade('tc-es3-decision').reasons[0].text).toMatch(/Continuing was confirmed.*within the hour.*1 hour 40/);
      } else {
        divert(r, card === 'tc-divert-large' ? 'large' : 'near', 'tc-continue-concern');
        expect(r.e.status.endReason).toBe('diversionSetUp');
        expect(grades(r)).toEqual([4, 4, card === 'tc-divert-large' ? 3 : 2]);
      }
    });

  it('a committed diversion suppresses the reminder even when the route is not set up', () => {
    const r = toDecision(); r.reply('tc-intentions', 'tc-divert-large'); r.tick(121);
    expect(r.cues.some(c => c.body.kind === 'message' && c.body.id === 'tc-timeout-reminder')).toBe(false);
    r.tick(60); expect(r.e.status.endReason).toBe('timeout');
  });

  it('an idle pilot passes both fallback timers and reaches the final timeout/debrief', () => {
    const r = mk(); r.tick(481);
    expect(r.e.status.endReason).toBe('timeout');
    expect(grades(r)).toEqual([1, 1, 1]);
  });

  it('can redo the decision set from its snapshot without a stale route or decision', () => {
    const r = toDecision(); divert(r, 'near');
    r.s.redo('tc-es3-decision');
    expect(r.e.state.destination).toBe('tc-dest');
    expect(r.e.firedFor('tc-es3-decision').size).toBe(0);
    divert(r, 'large');
    expect(r.s.results().original.map(g => g.grade)).toEqual([4, 4, 2]);
    expect(r.s.results().redo?.grade.grade).toBe(4);
  });
});
