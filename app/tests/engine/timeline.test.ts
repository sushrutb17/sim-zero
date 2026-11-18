import { describe, expect, it } from 'vitest';
import type { ControlId } from '../../src/contracts/aircraft';
import type { PilotAction } from '../../src/contracts/events';
import { parseScenario } from '../../src/contracts/scenario';
import { TrainerApp } from '../../src/app/controller';
import { TrainingSession } from '../../src/engine/session';
import { buildTimeline, CHANNEL_TAGS, CONTROL_NAMES, formatClock, type TimelineEntry } from '../../src/engine/timeline';
import singleSource from '../../src/scenarios/single-source';
import { miniScenario } from '../fixtures/mini-scenario';

const ASCII = /^[\x20-\x7E]*$/;
const texts = (e: TimelineEntry[]) => e.map((x) => x.text);

// --- mini scenario helpers --------------------------------------------------------------------------

function mini(patch?: (raw: typeof miniScenario) => void) {
  const raw = structuredClone(miniScenario);
  patch?.(raw);
  const scenario = parseScenario(raw);
  const s = new TrainingSession(scenario, { mode: 'auto' });
  s.start();
  const e = s.engine;
  const ctl = (controlId: ControlId, value: number | boolean | string) => e.dispatch({ kind: 'control', controlId, value });
  const timeline = (id: string): TimelineEntry[] => {
    const def = scenario.eventSets.find((x) => x.id === id)!;
    return buildTimeline(scenario, def, e.historyFor(id));
  };
  return { scenario, s, e, ctl, timeline };
}

// --- Single Source drivers (a trimmed copy of the helpers in tests/scenarios/single-source.test.ts) ---

function single() {
  const s = new TrainingSession(singleSource, { mode: 'auto' });
  const seen = new Set<string>();
  s.onCue((c) => {
    if (c.body.kind === 'message' || c.body.kind === 'alert') seen.add(c.body.id);
  });
  s.start();
  const e = s.engine;
  const ctl = (controlId: ControlId, value: number | boolean | string) => e.dispatch({ kind: 'control', controlId, value });
  const reply = (messageId: string, cardId: string) => e.dispatch({ kind: 'reply', messageId, cardId });
  const item = (checklistId: string, itemId: string) => e.dispatch({ kind: 'checklistItem', checklistId, itemId });
  const ack = (alertId: string) => e.dispatch({ kind: 'alertAck', alertId });
  const tick = (sec: number) => {
    for (let t = 0; t < sec - 1e-9 && e.status.run === 'running'; t += 0.1) e.tick(0.1);
  };
  const until = (what: string, pred: () => boolean, maxSec = 240) => {
    let t = 0;
    while (!pred()) {
      if (t > maxSec || e.status.run !== 'running') throw new Error(`timed out waiting for ${what}`);
      e.tick(0.1);
      t += 0.1;
    }
  };
  const waitFor = (id: string) => until(`cue ${id}`, () => seen.has(id));
  const inSet = (id: string) => until(`set ${id}`, () => e.status.eventSetId === id);
  const timeline = (id: string): TimelineEntry[] => {
    const def = singleSource.eventSets.find((x) => x.id === id)!;
    return buildTimeline(singleSource, def, e.historyFor(id));
  };
  return { s, e, ctl, reply, item, ack, tick, waitFor, inSet, timeline };
}
type Single = ReturnType<typeof single>;

function es1Good(r: Single) {
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
function es2Good(r: Single) {
  r.tick(2);
  r.reply('twr-takeoff', 'to-readback');
  r.waitFor('dep-climb');
  r.reply('dep-climb', 'dev-left');
  r.ctl('ap.engage', true);
  r.ctl('ap.alt', 12000);
  r.ctl('ap.vertical', 'climb');
  r.ctl('ap.hdg', 60);
  r.inSet('es3-gen-failure');
}
function es3Good(r: Single) {
  r.tick(1);
  r.reply('dep-handoff', 'ho-readback');
  r.waitFor('gen1-fail');
  r.tick(2);
  r.ack('gen1-fail');
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
function toEs4(r: Single) {
  es1Good(r);
  es2Good(r);
  es3Good(r);
  r.waitFor('ctr-intentions');
  r.tick(3);
}

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect([0, 9.99, 74.9, 600].map(formatClock)).toEqual(['0:00', '0:09', '1:14', '10:00']);
  });
});

describe('names', () => {
  it('channel tags and control names cover every channel and control', () => {
    expect(CHANNEL_TAGS).toEqual({ atc: 'ATC', cabin: 'CABIN', dispatch: 'DISPATCH', ground: 'GROUND', crew: 'F/O' });
    expect(Object.keys(CONTROL_NAMES)).toHaveLength(15);
    expect(CONTROL_NAMES['elec.gen1']).toBe('GEN 1');
    expect(CONTROL_NAMES['ap.hdg']).toBe('HDG');
    for (const n of Object.values(CONTROL_NAMES)) expect(n).toMatch(ASCII);
  });
});

describe('buildTimeline', () => {
  it('an empty history gives no entries', () => {
    const { scenario } = mini();
    expect(buildTimeline(scenario, scenario.eventSets[0], { snapshots: [], hintTimes: [] })).toEqual([]);
  });

  it('start cues are at 0:00 and come before a pilot action at the same time', () => {
    const m = mini();
    m.e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-no' }); // no tick: same instant as the start cues
    const t = m.timeline('es-a');
    expect(t[0]).toEqual({ tSec: 0, who: 'event', text: 'ATC: Message A1' });
    expect(t[1]).toMatchObject({ tSec: 0, who: 'you', text: 'REPLY TO ATC: No' });
  });

  it('a fired rule shows each of its message, alert and checklist cues at the time it fired', () => {
    const m = mini((raw) => {
      raw.eventSets[0].rules.push({
        id: 'r-multi',
        instructorLabel: 'Several cues at 8 s',
        when: { kind: 'atSec', sec: 8 },
        cues: [
          { kind: 'message', id: 'msg-cab', channel: 'cabin', text: 'Cabin is ready' },
          { kind: 'alert', id: 'alert-x', level: 'caution', text: 'TEST ALERT' },
          { kind: 'checklistAvailable', checklistId: 'cl-a' },
          { kind: 'aircraft', patch: { ap: { alt: 7000 } } },
        ],
      } as never);
    });
    m.e.tick(3);
    m.e.tick(3);
    m.e.tick(3);
    const t = m.timeline('es-a');
    const rest = t.filter((x) => x.tSec >= 8 - 1e-6);
    expect(texts(rest)).toEqual(['CABIN: Cabin is ready', 'ALERT: TEST ALERT', 'CHECKLIST OPEN: Checklist A']);
    for (const x of rest) expect(x.tSec).toBeCloseTo(9, 0);
    // the 5 s printout is there too, and the aircraft cue gives no entry
    expect(texts(t)).toContain('KNEEBOARD: Data');
    expect(t.some((x) => x.text.includes('7000'))).toBe(false);
  });

  it('an alert clear shows the alert text, or the id when the alert is unknown', () => {
    const m = mini((raw) => {
      raw.eventSets[1].rules.push({
        id: 'r-clear',
        instructorLabel: 'Clear things',
        when: { kind: 'atSec', sec: 2 },
        cues: [
          { kind: 'alertClear', id: 'alert-b' },
        ],
      } as never);
    });
    m.e.tick(3);
    m.e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    m.e.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    expect(m.e.status.eventSetId).toBe('es-b');
    m.e.tick(3);
    expect(texts(m.timeline('es-b'))).toEqual(['ALERT: GEN 1 OFF', 'CHECKLIST OPEN: Checklist A', 'ALERT CLEARED: GEN 1 OFF']);
  });

  it('twelve HDG presses are one line with the final value', () => {
    const m = mini();
    for (let v = 49; v <= 60; v++) {
      m.e.tick(0.1);
      m.ctl('ap.hdg', v);
    }
    const acts = m.e.actionsFor('es-a');
    const last = acts[acts.length - 1];
    const lines = m.timeline('es-a').filter((x) => x.who === 'you');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('HDG 060');
    expect(lines[0].tSec).toBeCloseTo(last.t, 6);
  });

  it('HDG, ALT, HDG are three lines', () => {
    const m = mini();
    m.ctl('ap.hdg', 60);
    m.e.tick(0.5);
    m.ctl('ap.alt', 7000);
    m.e.tick(0.5);
    m.ctl('ap.hdg', 70);
    expect(texts(m.timeline('es-a').filter((x) => x.who === 'you'))).toEqual(['HDG 060', 'ALT 7000', 'HDG 070']);
  });

  it('a switch cycled off and on keeps both lines (it is what a check grades); selector presses each keep a line', () => {
    const m = mini();
    m.ctl('elec.gen1', false);
    m.e.tick(1);
    m.ctl('elec.gen1', true);
    m.ctl('ap.lateral', 'nav');
    m.ctl('ap.lateral', 'hdg');
    expect(texts(m.timeline('es-a').filter((x) => x.who === 'you'))).toEqual(['GEN 1 OFF', 'GEN 1 ON', 'LATERAL NAV', 'LATERAL HDG']);
  });

  it('a reply comes before the message it triggers in the same instant', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    r.tick(1);
    r.reply('dep-handoff', 'ho-readback');
    const t = texts(r.timeline('es3-gen-failure'));
    const replyAt = t.indexOf('REPLY TO ATC: 126.85, Orvessa 214, good day.');
    const checkinAt = t.findIndex((x) => x.startsWith('ATC: Orvessa 214, Center, radar contact.'));
    expect(replyAt).toBeGreaterThanOrEqual(0);
    expect(checkinAt).toBeGreaterThan(replyAt);
  });

  it('at one instant the order is what happened: reply, the alert it triggers, then its acknowledgement', () => {
    const m = mini((raw) => {
      raw.eventSets[0].rules.push({
        id: 'r-test-alert',
        instructorLabel: 'Alert after a No reply',
        when: { kind: 'action', match: { kind: 'reply', messageId: 'msg-a1', cardId: 'card-no' } },
        cues: [{ kind: 'alert', id: 'test-alert', level: 'caution', text: 'TEST ALERT' }],
      } as never);
    });
    m.e.tick(1);
    m.e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-no' });
    m.e.dispatch({ kind: 'alertAck', alertId: 'test-alert' }); // no tick: same scenario time
    const t = texts(m.timeline('es-a'));
    const at = (s: string) => t.indexOf(s);
    expect(at('REPLY TO ATC: No')).toBeGreaterThan(0);
    expect(at('ALERT: TEST ALERT')).toBe(at('REPLY TO ATC: No') + 1);
    expect(at('ACKNOWLEDGED: TEST ALERT')).toBe(at('ALERT: TEST ALERT') + 1);
  });

  it('a reply shows the tag and the card text', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    r.tick(1);
    r.reply('dep-handoff', 'ho-readback');
    expect(texts(r.timeline('es3-gen-failure'))).toContain('REPLY TO ATC: 126.85, Orvessa 214, good day.');
  });

  it('a reply to an unknown message or card gives the ids', () => {
    const m = mini();
    m.e.dispatch({ kind: 'reply', messageId: 'msg-nope', cardId: 'card-nope' });
    expect(texts(m.timeline('es-a').filter((x) => x.who === 'you'))).toEqual(['REPLY TO msg-nope: card-nope']);
  });

  it('a switch shows ON or OFF; a destination shows the airport name', () => {
    const r = single();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-divert-alt1');
    r.tick(3);
    r.ctl('route.destination', 'alt1');
    expect(texts(r.timeline('es3-gen-failure'))).toContain('GEN 1 OFF');
    expect(texts(r.timeline('es3-gen-failure'))).toContain('BUS TIE ON');
    expect(texts(r.timeline('es4-decision'))).toContain('DESTINATION Kestry Field');
  });

  it('other values: strings upper case, numbers as they are, a heading with three digits', () => {
    const m = mini();
    m.ctl('ap.lateral', 'nav');
    m.ctl('baro.set', 1004);
    m.ctl('ap.hdg', 5);
    expect(texts(m.timeline('es-a').filter((x) => x.who === 'you'))).toEqual(['LATERAL NAV', 'BARO 1004', 'HDG 005']);
  });

  it('a hint shows HINT REQUESTED', () => {
    const m = mini();
    m.e.dispatch({ kind: 'hint', eventSetId: 'es-a' } as PilotAction);
    expect(texts(m.timeline('es-a').filter((x) => x.who === 'you'))).toEqual(['HINT REQUESTED']);
  });

  it('checklist items show the item text', () => {
    const m = mini();
    m.e.tick(3);
    m.e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    m.e.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    m.e.dispatch({ kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a2' });
    m.e.dispatch({ kind: 'alertAck', alertId: 'alert-b' });
    expect(texts(m.timeline('es-b'))).toEqual([
      'ALERT: GEN 1 OFF',
      'CHECKLIST OPEN: Checklist A',
      'CHECKED: Item two',
      'ACKNOWLEDGED: GEN 1 OFF',
    ]);
  });

  it('Single Source, Event Set 3 happy path: the alert comes before its acknowledgement, which comes before GEN 1 OFF', () => {
    const r = single();
    es1Good(r);
    es2Good(r);
    es3Good(r);
    const t = r.timeline('es3-gen-failure');
    const at = (s: string) => {
      const i = texts(t).indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    const alert = at('ALERT: GEN 1 FAULT');
    const ack = at('ACKNOWLEDGED: GEN 1 FAULT');
    const off = at('GEN 1 OFF');
    expect(alert).toBeLessThan(ack);
    expect(ack).toBeLessThan(off);
    expect(t[alert].who).toBe('event');
    expect(t[ack].who).toBe('you');
    // sorted by time
    for (let i = 1; i < t.length; i++) expect(t[i].tSec).toBeGreaterThanOrEqual(t[i - 1].tSec);
  });

  it('every entry text of a full Single Source run is printable ASCII', () => {
    const r = single();
    toEs4(r);
    r.reply('ctr-intentions', 'dec-return');
    r.tick(3);
    r.ctl('route.destination', 'dep');
    let n = 0;
    for (const es of singleSource.eventSets) {
      for (const x of r.timeline(es.id)) {
        n++;
        expect(x.text, x.text).toMatch(ASCII);
        expect(x.text.length).toBeGreaterThan(0);
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('a set that ended on its time limit with no action has only event entries', () => {
    const m = mini();
    m.e.tick(3);
    m.e.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    m.e.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    for (let i = 0; i < 400; i++) m.e.tick(0.5);
    expect(m.e.status).toMatchObject({ run: 'ended', endReason: 'timeout' });
    const t = m.timeline('es-b');
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.who === 'event')).toBe(true);
    expect(texts(t).some((x) => x.includes('Say intentions'))).toBe(false);
  });

  it('a long timeout in Single Source Event Set 4 has only event entries and no soft-timeout prompt', () => {
    const r = single();
    toEs4(r);
    r.tick(400);
    expect(r.e.status).toMatchObject({ run: 'ended', endReason: 'timeout' });
    const t = r.timeline('es4-decision');
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.who === 'event')).toBe(true);
  });
});

describe('TrainerApp.review', () => {
  // review() reads only the session, so a bare TrainerApp with a real session is enough here.
  const appOver = (s: TrainingSession) => Object.assign(Object.create(TrainerApp.prototype), { session: s }) as TrainerApp;
  const drive = (s: TrainingSession) => {
    s.engine.tick(3);
    s.engine.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    s.engine.tick(2);
    s.engine.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    s.engine.dispatch({ kind: 'control', controlId: 'route.destination', value: 'dep' });
  };

  it('gives the first attempt, then the redo for that set only, and null for an ungraded set', () => {
    const s = new TrainingSession(parseScenario(structuredClone(miniScenario)), { mode: 'auto' });
    s.start();
    const app = appOver(s);
    expect(app.review('es-a')).toBeNull(); // nothing graded yet
    drive(s);
    expect(app.review('es-a')?.attempt).toBe('first');
    expect(app.review('nope')).toBeNull();
    s.redo('es-a');
    s.engine.dispatch({ kind: 'control', controlId: 'ap.hdg', value: 77 }); // only in the redo
    s.engine.dispatch({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    s.engine.dispatch({ kind: 'control', controlId: 'lights.landing', value: true });
    const redo = app.review('es-a')!;
    expect(redo.attempt).toBe('redo');
    expect(redo.review.entries.map((e) => e.text)).toContain('HDG 077');
    expect(app.review('es-b')?.attempt).toBe('first');
    s.restart();
    expect(app.review('es-a')).toBeNull();
  });
});
