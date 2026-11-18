// withVoice (T12 / Task A2): the scenario gets its audio paths from the generated list of voiced message ids.
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseScenario, type Scenario } from '../../src/contracts/scenario';
import { VOICED_MESSAGE_IDS } from '../../src/scenarios/single-source.voice';
import { withVoice } from '../../src/scenarios/voice';
import singleSource from '../../src/scenarios/single-source';
import { allScenarios } from '../../src/scenarios/registry';
import { timeCritical } from '../../src/scenarios/time-critical';
import { isAudioPath } from '../../src/xr/audio';
import { miniScenario } from '../fixtures/mini-scenario';

// Loose cue typing: the fixtures are plain literals (kind: string), the parsed scenario is the strict Scenario type.
interface TestCue { kind: string; id?: string; audio?: string }
type MessageCue = TestCue & { id: string };
interface HasCues {
  eventSets: readonly { startCues: readonly TestCue[]; rules: readonly { cues: readonly TestCue[] }[] }[];
  softTimeout: { promptCue: TestCue };
}

const voiceDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/audio/voice');

/** Every cue in the same places the engine and tools/audio-cues.mjs look: start cues, rule cues, soft-timeout prompt. */
function allCues(s: HasCues): TestCue[] {
  const out: TestCue[] = [];
  for (const set of s.eventSets) {
    out.push(...set.startCues);
    for (const rule of set.rules) out.push(...rule.cues);
  }
  out.push(s.softTimeout.promptCue);
  return out;
}
const messages = (s: HasCues): MessageCue[] => allCues(s).filter((c): c is MessageCue => c.kind === 'message');
const find = (s: HasCues, id: string): MessageCue => {
  const cue = messages(s).find((c) => c.id === id);
  if (!cue) throw new Error(`no message ${id}`);
  return cue;
};

describe('withVoice', () => {
  it('adds the clip path to voiced messages only', () => {
    const out = withVoice(miniScenario, ['msg-a1']);
    expect(find(out, 'msg-a1').audio).toBe('/audio/voice/msg-a1.mp3');
    expect('audio' in find(out, 'msg-a2')).toBe(false);
  });

  it('covers start cues, rule cues and the soft-timeout prompt', () => {
    const out = withVoice(miniScenario, ['msg-a1', 'msg-a2', 'msg-intentions']);
    expect(out.eventSets[0].startCues[0]).toMatchObject({ id: 'msg-a1', audio: '/audio/voice/msg-a1.mp3' });
    const rule = out.eventSets[0].rules.find((r) => r.id === 'r-a-reply');
    expect(rule?.cues[0]).toMatchObject({ id: 'msg-a2', audio: '/audio/voice/msg-a2.mp3' });
    expect(out.softTimeout.promptCue).toMatchObject({ id: 'msg-intentions', audio: '/audio/voice/msg-intentions.mp3' });
  });

  it('gives no other cue an audio field, even when its id is listed', () => {
    const out = withVoice(miniScenario, ['msg-a1', 'pr-a', 'alert-b', 'r-a-reply', 'es-a']);
    const others = allCues(out).filter((c) => c.kind !== 'message');
    expect(others.length).toBeGreaterThan(0);
    for (const cue of others) expect('audio' in cue).toBe(false);
    expect(find(out, 'msg-a1').audio).toBe('/audio/voice/msg-a1.mp3');
  });

  it('does not mutate its input and returns a deep copy', () => {
    const before = JSON.stringify(miniScenario);
    const out = withVoice(miniScenario, ['msg-a1', 'msg-a2', 'msg-intentions']);
    expect(JSON.stringify(miniScenario)).toBe(before);
    expect(out).not.toBe(miniScenario);
    expect(out.eventSets[0]).not.toBe(miniScenario.eventSets[0]);
    expect(out.eventSets[0].startCues[0]).not.toBe(miniScenario.eventSets[0].startCues[0]);
    expect(out.softTimeout.promptCue).not.toBe(miniScenario.softTimeout.promptCue);
  });

  it('with an empty list the copy equals the input', () => {
    expect(withVoice(miniScenario, [])).toEqual(miniScenario);
  });

  it('an id that is not a message in the scenario is ignored', () => {
    const out = withVoice(miniScenario, ['no-such-message', 'es-a', 'pr-a']);
    expect(out).toEqual(miniScenario);
  });

  it('a message sent twice gets the same audio path both times', () => {
    const resend = miniScenario.eventSets[0].startCues[0];
    const twice = {
      ...miniScenario,
      eventSets: miniScenario.eventSets.map((set, i) =>
        i === 1
          ? { ...set, rules: [...set.rules, { id: 'r-b-resend', instructorLabel: 'Resend A1', when: { kind: 'atSec', sec: 3 }, cues: [{ ...resend }] }] }
          : set,
      ),
    };
    const out = withVoice(twice, ['msg-a1']);
    const sends = messages(out).filter((c) => c.id === 'msg-a1');
    expect(sends).toHaveLength(2);
    expect(sends.map((c) => c.audio)).toEqual(['/audio/voice/msg-a1.mp3', '/audio/voice/msg-a1.mp3']);
    // The contract rejects a message id reused with different content, so both sends must still parse.
    expect(() => parseScenario(out)).not.toThrow();
  });

  it('the voiced mini scenario still passes parseScenario, and every path passes isAudioPath', () => {
    const out = withVoice(miniScenario, ['msg-a1', 'msg-a2', 'msg-intentions']);
    expect(() => parseScenario(out)).not.toThrow();
    for (const cue of messages(out)) expect(isAudioPath(cue.audio)).toBe(true);
  });
});

describe('voice across every registered flight', () => {
  const scenarios = allScenarios();
  const cues = scenarios.flatMap((s) => messages(s));
  const voicedSet = new Set(VOICED_MESSAGE_IDS);

  it('has message cues to voice', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    expect(cues.length).toBeGreaterThan(0);
  });

  it('in every scenario a message has an audio path exactly when it is in the voiced list', () => {
    for (const scenario of scenarios) {
      for (const cue of messages(scenario)) expect(cue.audio !== undefined, `${scenario.id}/${cue.id}`).toBe(voicedSet.has(cue.id));
    }
  });

  it('every voiced id is a message of at least one registered flight and has a non-empty clip on disk', () => {
    const ids = new Set(cues.map((c) => c.id));
    for (const id of VOICED_MESSAGE_IDS) {
      expect(ids.has(id), `${id} is not a message of any registered flight`).toBe(true);
      const file = resolve(voiceDir, `${id}.mp3`);
      expect(existsSync(file), `${id}.mp3 missing`).toBe(true);
      expect(statSync(file).size, `${id}.mp3 empty`).toBeGreaterThan(0);
    }
  });

  it('a message sent twice carries the same audio path every time', () => {
    for (const scenario of scenarios) {
      const byId = new Map<string, Set<string | undefined>>();
      for (const cue of messages(scenario)) byId.set(cue.id, (byId.get(cue.id) ?? new Set()).add(cue.audio));
      for (const [id, paths] of byId) expect(paths.size, `${scenario.id}/${id}`).toBe(1);
    }
  });

  it('with every message voiced the Single Source baseline still parses and every path is a safe audio path', () => {
    const allIds = [...new Set(messages(singleSource).map((c) => c.id))];
    const voiced: Scenario = parseScenario(withVoice(singleSource, allIds));
    for (const cue of messages(voiced)) {
      expect(cue.audio, cue.id).toBe(`/audio/voice/${cue.id}.mp3`);
      expect(isAudioPath(cue.audio), cue.id).toBe(true);
    }
  });

  it('with every message voiced Time Critical still parses and every path is a safe audio path', () => {
    const allIds = [...new Set(messages(timeCritical).map((c) => c.id))];
    const voiced: Scenario = parseScenario(withVoice(timeCritical, allIds));
    for (const cue of messages(voiced)) {
      expect(cue.audio, cue.id).toBe(`/audio/voice/${cue.id}.mp3`);
      expect(isAudioPath(cue.audio), cue.id).toBe(true);
    }
  });
});
