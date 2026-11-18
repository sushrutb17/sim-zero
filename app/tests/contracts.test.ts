import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { AircraftPatchSchema, CONTROL_IDS } from '../src/contracts/aircraft';
import { EndReasonSchema, REASON_LABELS, pilotSafe, type WorldCue } from '../src/contracts/events';
import { parseScenario, pilotSafe as pilotSafeFromScenario } from '../src/contracts/scenario';
import { parseRemoteMsg } from '../src/contracts/remote';
import { EventBus } from '../src/bus/eventBus';
import { miniScenario } from './fixtures/mini-scenario';

const clone = () => structuredClone(miniScenario) as any;
const issuePaths = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZodError) return e.issues.map((i) => i.path.join('.'));
    throw e;
  }
  throw new Error('expected parse to throw');
};

describe('scenario schema', () => {
  it('parses mini fixture', () => {
    expect(parseScenario(miniScenario).eventSets.length).toBe(2);
  });

  it('rejects unknown condition kind', () => {
    const s = clone();
    s.eventSets[0].rules[0].when = { kind: 'whenever' };
    expect(issuePaths(() => parseScenario(s)).some((p) => p.startsWith('eventSets.0.rules.0.when'))).toBe(true);
  });

  it('rejects grade-check with unknown category', () => {
    const s = clone();
    s.eventSets[0].checks[0].category = 'vibes';
    expect(() => parseScenario(s)).toThrow(ZodError);
  });

  it('rejects unknown keys (strict)', () => {
    const s = clone();
    s.eventSets[0].secret = 'x';
    expect(() => parseScenario(s)).toThrow(ZodError);
  });

  it('rejects unknown aircraft state path', () => {
    const s = clone();
    s.eventSets[0].endWhen.of[1].path = 'lights.landingg';
    expect(issuePaths(() => parseScenario(s)).some((p) => p.startsWith('eventSets.0.endWhen'))).toBe(true);
  });

  it('rejects ruleFired pointing at unknown rule', () => {
    const s = clone();
    s.eventSets[0].rules[2].when.ruleId = 'nope';
    expect(() => parseScenario(s)).toThrow(/ruleFired 'nope' is not a rule of event set 'es-a'/);
  });

  it('rejects duplicate event set ids', () => {
    const s = clone();
    s.eventSets[1].id = 'es-a';
    expect(() => parseScenario(s)).toThrow(/duplicate event set id 'es-a'/);
  });

  it('rejects soft timeout on unknown event set', () => {
    const s = clone();
    s.softTimeout.eventSetId = 'es-z';
    expect(() => parseScenario(s)).toThrow(/softTimeout/);
  });

  it('parses softTimeout.skipPromptWhen', () => {
    const s = clone();
    s.softTimeout.skipPromptWhen = { kind: 'any', of: [{ kind: 'ruleFired', ruleId: 'r-a-reply' }, { kind: 'state', path: 'destination', op: 'eq', value: 'dep' }] };
    expect(parseScenario(s).softTimeout.skipPromptWhen).toBeDefined();
  });

  it('rejects a bad reference inside softTimeout.skipPromptWhen', () => {
    const s = clone();
    s.softTimeout.skipPromptWhen = { kind: 'ruleFired', ruleId: 'r-nope' };
    expect(issuePaths(() => parseScenario(s))).toContain('softTimeout.skipPromptWhen');
    const t = clone();
    t.softTimeout.skipPromptWhen = { kind: 'state', path: 'destination', op: 'eq', value: 'nowhere' };
    expect(issuePaths(() => parseScenario(t))).toContain('softTimeout.skipPromptWhen');
  });

  it('rejects comm check for a message no cue sends', () => {
    const s = clone();
    s.eventSets[0].checks[1].messageId = 'msg-ghost';
    expect(() => parseScenario(s)).toThrow(/msg-ghost/);
  });

  it('rejects unknown control id in practice', () => {
    const s = clone();
    s.practice.controlId = 'flaps.lever';
    expect(() => parseScenario(s)).toThrow(ZodError);
  });
});

describe('scenario content references (authoring safety)', () => {
  it('parses checklists and airports', () => {
    const sc = parseScenario(miniScenario);
    expect(sc.checklists[0].items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(sc.airports.map((a) => a.id)).toEqual(['dep', 'dest']);
  });

  it('rejects checklistAvailable for an unknown checklist', () => {
    const s = clone();
    s.eventSets[1].startCues[1].checklistId = 'cl-ghost';
    expect(() => parseScenario(s)).toThrow(/cl-ghost/);
  });

  it('rejects checklistItem match with an unknown item', () => {
    const s = clone();
    s.eventSets[1].checks.push({ kind: 'required', id: 'chk-item', when: { kind: 'action', match: { kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a9' } }, category: 'procedures', reason: 'r' });
    expect(() => parseScenario(s)).toThrow(/a9/);
  });

  it('rejects a destination that is not an airport', () => {
    const s = clone();
    s.endConditions[0].when.value = 'atlantis';
    expect(() => parseScenario(s)).toThrow(/atlantis/);
    const t = clone();
    t.eventSets[1].endWhen.match.value = 'atlantis';
    expect(() => parseScenario(t)).toThrow(/atlantis/);
  });

  it('rejects a misspelled action match field', () => {
    const s = clone();
    s.eventSets[0].rules[1].when.match = { kind: 'reply', messageID: 'msg-a1', cardId: 'card-yes' };
    expect(() => parseScenario(s)).toThrow(ZodError);
  });

  it('rejects control match value of the wrong type', () => {
    const s = clone();
    s.eventSets[1].checks[0].when.match.value = 'off';
    expect(() => parseScenario(s)).toThrow(/elec\.gen2/);
  });

  it('rejects state comparison with the wrong value type', () => {
    const s = clone();
    s.eventSets[0].endWhen.of[1].value = 'true';
    expect(() => parseScenario(s)).toThrow(/lights\.landing/);
  });

  it('rejects gte/lte on a non-numeric path', () => {
    const s = clone();
    s.eventSets[0].endWhen.of[1] = { kind: 'state', path: 'lights.landing', op: 'gte', value: 1 };
    expect(() => parseScenario(s)).toThrow(/numeric/);
  });

  it('rejects reply match with a card the message does not offer', () => {
    const s = clone();
    s.eventSets[0].rules[1].when.match.cardId = 'card-maybe';
    expect(() => parseScenario(s)).toThrow(/card-maybe/);
  });

  it('rejects a standalone cardId that no message offers', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'reply', cardId: 'card-ghost' } };
    expect(() => parseScenario(s)).toThrow(/card-ghost/);
  });

  it('accepts a standalone cardId that some message offers', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'reply', cardId: 'card-yes' } };
    expect(() => parseScenario(s)).not.toThrow();
  });

  it('rejects a standalone itemId that no checklist has', () => {
    const s = clone();
    s.eventSets[1].endWhen = { kind: 'action', match: { kind: 'checklistItem', itemId: 'zz' } };
    expect(() => parseScenario(s)).toThrow(/zz/);
  });

  it('rejects alertAck for an alert no cue raises', () => {
    const s = clone();
    s.eventSets[1].endWhen = { kind: 'action', match: { kind: 'alertAck', alertId: 'alert-ghost' } };
    expect(() => parseScenario(s)).toThrow(/alert-ghost/);
  });

  it('rejects forward reference to an alert raised only in a later set', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'alertAck', alertId: 'alert-b' } };
    expect(() => parseScenario(s)).toThrow(/alert-b/);
  });

  it('rejects ruleFired on a rule of another event set', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'ruleFired', ruleId: 'r-b-fail' };
    expect(() => parseScenario(s)).toThrow(/r-b-fail/);
  });

  it('rejects checklist item before the checklist is opened', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a1' } };
    expect(() => parseScenario(s)).toThrow(/cl-a/);
  });

  it('rejects checklist item for a checklist no cue ever opens', () => {
    const s = clone();
    s.eventSets[1].startCues = s.eventSets[1].startCues.filter((c: any) => c.kind !== 'checklistAvailable');
    s.eventSets[1].endWhen = { kind: 'action', match: { kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a1' } };
    expect(() => parseScenario(s)).toThrow(/cl-a/);
  });

  it('rejects hint match naming a different event set', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'hint', eventSetId: 'es-b' } };
    expect(() => parseScenario(s)).toThrow(/es-b/);
  });

  it('rejects id-less alertAck when no alert is reachable', () => {
    const s = clone();
    s.eventSets[0].endWhen = { kind: 'action', match: { kind: 'alertAck' } };
    expect(() => parseScenario(s)).toThrow(/alert/);
  });

  it('rejects reply to a message sent in an earlier set (cards are per set)', () => {
    const s = clone();
    s.eventSets[1].endWhen = { kind: 'action', match: { kind: 'reply', messageId: 'msg-a1', cardId: 'card-no' } };
    expect(() => parseScenario(s)).toThrow(/msg-a1/);
  });

  it('rejects comm check on a message from an earlier set', () => {
    const s = clone();
    s.eventSets[1].checks.push({ kind: 'comm', id: 'chk-late', messageId: 'msg-a1', quality: { 'card-yes': 'good', 'card-no': 'poor' }, category: 'crm', reason: 'r' });
    expect(() => parseScenario(s)).toThrow(/msg-a1/);
  });

  it('rejects comm quality that does not cover exactly the offered cards', () => {
    const missing = clone();
    delete missing.eventSets[0].checks[1].quality['card-no'];
    expect(() => parseScenario(missing)).toThrow(/card-no/);
    const extra = clone();
    extra.eventSets[0].checks[1].quality['card-x'] = 'good';
    expect(() => parseScenario(extra)).toThrow(/card-x/);
  });

  it('rejects conflicting reuse of a message id', () => {
    const s = clone();
    s.eventSets[1].startCues.push({ kind: 'message', id: 'msg-a1', channel: 'cabin', text: 'Different text' });
    expect(() => parseScenario(s)).toThrow(/msg-a1/);
  });

  it('rejects duplicate check ids', () => {
    const s = clone();
    s.eventSets[1].checks[0].id = 'chk-lights';
    expect(() => parseScenario(s)).toThrow(/chk-lights/);
  });

  it('aircraft patch accepts nested partial generator state (deep merge contract)', () => {
    expect(AircraftPatchSchema.parse({ elec: { gen1: { failed: true } } })).toEqual({ elec: { gen1: { failed: true } } });
  });
});

describe('events', () => {
  it('REASON_LABELS exact', () => {
    expect(REASON_LABELS).toEqual({
      crm: 'Communication & CRM',
      automation: 'Automation',
      handling: 'Aircraft handling',
      procedures: 'Procedures',
      systems: 'Systems knowledge',
    });
  });

  it('pilotSafe passes a normal cue through unchanged', () => {
    const cue: WorldCue = { kind: 'message', id: 'm', channel: 'cabin', text: 'Hi' };
    expect(pilotSafe(cue)).toBe(cue);
  });

  it('channel crew is accepted for first officer callouts; an unknown channel is still rejected (T31)', () => {
    const cue: WorldCue = { kind: 'message', id: 'fo-line', channel: 'crew', text: 'Autopilot engaged.' };
    expect(pilotSafe(cue)).toBe(cue);
    expect(() => pilotSafe({ kind: 'message', id: 'm', channel: 'tower', text: 'x' } as any)).toThrow();
  });

  it('pilotSafe is also exported from scenario', () => {
    expect(pilotSafeFromScenario).toBe(pilotSafe);
  });

  it('pilotSafe rejects instructor fields', () => {
    const cue = { kind: 'message', id: 'm', channel: 'atc', text: 'x', instructorNotes: 'secret' } as any;
    expect(() => pilotSafe(cue)).toThrow();
  });

  it('control id list is the frozen set', () => {
    expect(CONTROL_IDS).toContain('elec.busTie');
    expect(CONTROL_IDS).toHaveLength(15);
  });
});

describe('end reasons (T44 amendment)', () => {
  it("accepts 'completed' as a scenario end reason, a scenarioEnd cue and a progress end reason; unknown reasons still fail", () => {
    expect(EndReasonSchema.parse('completed')).toBe('completed');
    expect(() => EndReasonSchema.parse('finished')).toThrow(ZodError);
    const s = clone();
    s.endConditions[0].reason = 'completed';
    expect(parseScenario(s).endConditions[0].reason).toBe('completed');
    s.endConditions[0].reason = 'finished';
    expect(() => parseScenario(s)).toThrow(ZodError);
    expect(pilotSafe({ kind: 'scenarioEnd', reason: 'completed' }).kind).toBe('scenarioEnd');
    expect(() => pilotSafe({ kind: 'scenarioEnd', reason: 'finished' } as unknown as WorldCue)).toThrow(ZodError);
    const m = parseRemoteMsg({ kind: 'progress', eventSetId: null, t: 0, run: 'ended', paused: false, endReason: 'completed', firedRuleIds: [], grades: [] });
    expect(m.kind === 'progress' && m.endReason).toBe('completed');
  });
});

describe('remote messages', () => {
  it('parses a valid fireRule message', () => {
    expect(parseRemoteMsg({ kind: 'fireRule', eventSetId: 'es-a', ruleId: 'r-a-time' }).kind).toBe('fireRule');
  });

  it('progress carries authoritative session status', () => {
    const m = parseRemoteMsg({ kind: 'progress', eventSetId: null, t: 0, run: 'ended', paused: false, endReason: 'timeout', firedRuleIds: ['r-a-time'], grades: [] });
    expect(m.kind === 'progress' && m.firedRuleIds).toEqual(['r-a-time']);
  });

  it('rejects malformed messages', () => {
    expect(() => parseRemoteMsg({ kind: 'gradeOverride', eventSetId: 'es-a', grade: 7, comment: '' })).toThrow();
    expect(() => parseRemoteMsg({ kind: 'deleteEverything' })).toThrow();
  });
});

describe('event bus', () => {
  it('delivers cue and action once each', () => {
    const bus = new EventBus();
    const cues: unknown[] = [];
    const actions: unknown[] = [];
    bus.onCue((c) => cues.push(c));
    bus.onAction((a) => actions.push(a));
    bus.emitCue({ t: 1, seq: 0, body: { kind: 'alertClear', id: 'a' } });
    bus.emitAction({ kind: 'alertAck', alertId: 'a' });
    expect(cues).toHaveLength(1);
    expect(actions).toEqual([{ kind: 'alertAck', alertId: 'a' }]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.onAction(() => n++);
    off();
    bus.emitAction({ kind: 'hint', eventSetId: 'es-a' });
    expect(n).toBe(0);
  });
});

describe('guide steps (T24)', () => {
  const step = (over: Record<string, unknown> = {}) => ({
    id: 'g-a1',
    where: 'COMMS PANEL',
    text: 'Press the framed reply.',
    light: [{ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' }],
    doneWhen: { kind: 'action', match: { kind: 'reply', messageId: 'msg-a1' } },
    ...over,
  });
  const withGuide = (steps: unknown[], set = 0) => {
    const s = clone();
    s.eventSets[set].guide = steps;
    return s;
  };

  it('a scenario without any guide still parses', () => {
    expect(parseScenario(miniScenario).eventSets.every((e) => e.guide === undefined)).toBe(true);
  });

  it('parses a valid guide with every kind of light, onlyWhen and waitText', () => {
    const s = withGuide([
      step(),
      step({ id: 'g-a2', light: [{ kind: 'control', controlId: 'lights.landing', value: true }], doneWhen: { kind: 'state', path: 'lights.landing', op: 'eq', value: true } }),
      step({ id: 'g-a3', light: [{ kind: 'control', controlId: 'ap.hdg', value: 60 }], onlyWhen: { kind: 'action', match: { kind: 'reply', cardId: 'card-yes' } }, waitText: 'Wait for the call.' }),
      step({ id: 'g-a4', light: [{ kind: 'reply', cardId: 'card-yes' }, { kind: 'reply', cardId: 'card-no' }] }),
    ]);
    s.eventSets[1].guide = [
      step({ id: 'g-b1', light: [{ kind: 'alertAck', alertId: 'alert-b' }], doneWhen: { kind: 'action', match: { kind: 'alertAck', alertId: 'alert-b' } } }),
      step({ id: 'g-b2', light: [{ kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a1' }], doneWhen: { kind: 'action', match: { kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a1' } } }),
      step({ id: 'g-b3', light: [{ kind: 'control', controlId: 'route.destination', value: 'dep' }], doneWhen: { kind: 'state', path: 'destination', op: 'eq', value: 'dep' } }),
    ];
    const sc = parseScenario(s);
    expect(sc.eventSets[0].guide?.map((g) => g.id)).toEqual(['g-a1', 'g-a2', 'g-a3', 'g-a4']);
    expect(sc.eventSets[1].guide).toHaveLength(3);
  });

  it('rejects duplicate step ids within one event set', () => {
    expect(() => parseScenario(withGuide([step(), step()]))).toThrow(/duplicate guide step/);
  });

  it('rejects a light of kind hint', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'hint' }] })]))).toThrow(/cannot be lit/);
  });

  it('rejects a control light without controlId', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'control' }] })]))).toThrow(/needs controlId/);
  });

  it.each(['ap.hdg', 'ap.alt', 'baro.set', 'ap.lateral', 'ap.vertical', 'route.destination'])('rejects a %s light without a value', (controlId) => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'control', controlId }] })]))).toThrow(/needs a value/);
  });

  it('accepts a toggle light without a value', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'control', controlId: 'lights.strobe' }] })]))).not.toThrow();
  });

  it('rejects a reply light with neither messageId nor cardId', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'reply' }] })]))).toThrow(/needs messageId or cardId/);
  });

  it('rejects a checklistItem light missing checklistId or itemId, and an alertAck light without alertId', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'checklistItem', checklistId: 'cl-a' }] })], 1))).toThrow(/needs checklistId and itemId/);
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'checklistItem', itemId: 'a1' }] })], 1))).toThrow(/needs checklistId and itemId/);
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'alertAck' }] })], 1))).toThrow(/needs alertId/);
  });

  it('rejects a reply light naming a message or card this event set never sends', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'reply', messageId: 'msg-ghost', cardId: 'card-yes' }] })]))).toThrow(/msg-ghost/);
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'reply', messageId: 'msg-a1', cardId: 'card-ghost' }] })]))).toThrow(/card-ghost/);
    // msg-a1 belongs to set A: set B cannot light it
    expect(() => parseScenario(withGuide([step({ doneWhen: { kind: 'atSec', sec: 1 } })], 1))).toThrow(/msg-a1/);
  });

  it('rejects a checklistItem light naming an unknown checklist or item', () => {
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'checklistItem', checklistId: 'cl-ghost', itemId: 'a1' }] })], 1))).toThrow(/cl-ghost/);
    expect(() => parseScenario(withGuide([step({ light: [{ kind: 'checklistItem', checklistId: 'cl-a', itemId: 'a9' }] })], 1))).toThrow(/a9/);
  });

  it('validates doneWhen and onlyWhen like a rule condition of that set', () => {
    expect(() => parseScenario(withGuide([step({ doneWhen: { kind: 'ruleFired', ruleId: 'r-b-fail' } })]))).toThrow(/r-b-fail/);
    expect(() => parseScenario(withGuide([step({ onlyWhen: { kind: 'action', match: { kind: 'reply', cardId: 'card-ghost' } } })]))).toThrow(/card-ghost/);
  });

  it.each(['where', 'text', 'waitText'])('rejects non-ASCII text in %s', (field) => {
    expect(() => parseScenario(withGuide([step({ [field]: 'Turn left → now' })]))).toThrow(/ASCII/);
  });

  it('reports the path of the offending step', () => {
    expect(issuePaths(() => parseScenario(withGuide([step(), step({ id: 'g-a2', light: [{ kind: 'hint' }] })])))).toContain('eventSets.0.guide.1.light.0');
  });
});
