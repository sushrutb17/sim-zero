// T41: the asset catalog lists the voice clips of every flight and variation, the first flight's baseline first, with the
// priorities (voice = lazy: registered, loaded by src/xr/voiceLoader.ts after the welcome screen; sounds = critical).
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScenario } from '../../src/contracts/scenario';
import { allScenarios, FLIGHTS } from '../../src/scenarios/registry';
import { VOICED_MESSAGE_IDS } from '../../src/scenarios/single-source.voice';
import { createAudioAssets, createAudioAssetsFromVoiced, voiceAssetIds } from '../../src/xr/audioAssets';
import { miniScenario } from '../fixtures/mini-scenario';

vi.mock('@iwsdk/core', () => ({ AssetType: { Audio: 'audio' }, defineAssets: (a: unknown) => a }));

const withVoice = (id: string, audio: string) => {
  const raw = structuredClone(miniScenario);
  raw.id = id;
  (raw.eventSets[0].startCues[0] as { audio?: string }).audio = audio;
  return parseScenario(raw);
};
const voiceUrls = (m: Record<string, { url: string; priority: string }>) => Object.values(m).filter((a) => a.priority === 'lazy').map((a) => a.url);

describe('audio catalog from every flight (T41)', () => {
  it('a single scenario still works, and a list is the union with duplicates listed once', () => {
    const a = withVoice('a', '/audio/voice/one.mp3');
    const b = withVoice('b', '/audio/voice/two.mp3');
    expect(voiceUrls(createAudioAssets(a, '/'))).toEqual(['/audio/voice/one.mp3']);
    expect(voiceUrls(createAudioAssets([a, b, a], '/'))).toEqual(['/audio/voice/one.mp3', '/audio/voice/two.mp3']);
    expect(Object.keys(createAudioAssets([], '/'))).toHaveLength(6); // the six sounds only
    expect(Object.keys(createAudioAssets(undefined, '/'))).toHaveLength(6);
  });

  it('lists the first scenario\'s clips first, every clip once, voice lazy and sounds critical', () => {
    const first = withVoice('a', '/audio/voice/first.mp3');
    const later = withVoice('b', '/audio/voice/later.mp3');
    const m = createAudioAssets([first, later], '/trainer/');
    expect(voiceUrls(m)).toEqual(['/trainer/audio/voice/first.mp3', '/trainer/audio/voice/later.mp3']);
    const prio = Object.values(m).map((a) => a.priority);
    expect(prio.filter((p) => p === 'critical')).toHaveLength(6);
    expect(prio.filter((p) => p === 'lazy')).toHaveLength(2);
    expect(prio.filter((p) => (p as string) === 'background')).toHaveLength(0);
    expect(Object.keys(m).every((k) => k.startsWith('trainer-audio:'))).toBe(true);
  });

  it('allScenarios() covers every registered flight and variation, baseline of the first flight first', () => {
    const all = allScenarios();
    expect(all).toHaveLength(FLIGHTS.reduce((n, f) => n + f.variations, 0));
    expect(all[0]).toBe(FLIGHTS[0].build(0));
  });

  it('src/assets.ts is built from the voiced list: the same keys as every flight\'s catalog, and every clip is a lazy voice entry', async () => {
    const { default: assets } = (await import('../../src/assets')) as unknown as { default: Record<string, { url: string; priority: string }> };
    const expected = createAudioAssets(allScenarios());
    expect(Object.keys(assets).sort()).toEqual(Object.keys(expected).sort());
    expect(voiceUrls(assets).length).toBeGreaterThan(0);
    for (const a of Object.values(assets)) expect(a.priority).toBe(a.url.includes('/audio/voice/') ? 'lazy' : 'critical');
  });

  it('src/assets.ts does not import the scenario registry (it would build every flight at start-up)', () => {
    const text = readFileSync(new URL('../../src/assets.ts', import.meta.url), 'utf8');
    expect(text).not.toContain('scenarios/registry');
  });
});

describe('audio catalog from the voiced list', () => {
  it('lists the sounds as critical and each voice clip as lazy', () => {
    const m = createAudioAssetsFromVoiced(['one', 'two'], '/');
    const entries = Object.values(m);
    expect(entries.filter((a) => a.priority === 'critical')).toHaveLength(6);
    expect(entries.filter((a) => a.priority === 'critical').every((a) => a.url.startsWith('/audio/sfx/'))).toBe(true);
    expect(voiceUrls(m)).toEqual(['/audio/voice/one.mp3', '/audio/voice/two.mp3']);
    expect(Object.keys(m).every((k) => k.startsWith('trainer-audio:'))).toBe(true);
    expect(Object.keys(m).slice(0, 6).every((k) => m[k].priority === 'critical')).toBe(true); // sounds first
  });

  it('voiceAssetIds returns the voice ids in catalog order, and no sound', () => {
    const m = createAudioAssetsFromVoiced(['zulu', 'alpha', 'mike'], '/');
    expect(voiceAssetIds(m)).toEqual(['trainer-audio:/audio/voice/zulu.mp3', 'trainer-audio:/audio/voice/alpha.mp3', 'trainer-audio:/audio/voice/mike.mp3']);
    expect(voiceAssetIds(createAudioAssetsFromVoiced([], '/'))).toEqual([]);
    const all = voiceAssetIds(createAudioAssetsFromVoiced(VOICED_MESSAGE_IDS, '/'));
    expect(all).toEqual(VOICED_MESSAGE_IDS.map((id) => `trainer-audio:/audio/voice/${id}.mp3`));
    expect(all.some((id) => id.includes('/audio/sfx/'))).toBe(false);
  });

  it('keeps the order of the ids it is given', () => {
    expect(voiceUrls(createAudioAssetsFromVoiced(['zulu', 'alpha', 'mike'], '/'))).toEqual(['/audio/voice/zulu.mp3', '/audio/voice/alpha.mp3', '/audio/voice/mike.mp3']);
  });

  it('lists a duplicated id once', () => {
    expect(voiceUrls(createAudioAssetsFromVoiced(['a', 'b', 'a', 'b', 'a'], '/'))).toEqual(['/audio/voice/a.mp3', '/audio/voice/b.mp3']);
  });

  it('respects the base URL, with or without a trailing slash', () => {
    expect(voiceUrls(createAudioAssetsFromVoiced(['a'], '/trainer/'))).toEqual(['/trainer/audio/voice/a.mp3']);
    expect(voiceUrls(createAudioAssetsFromVoiced(['a'], '/trainer'))).toEqual(['/trainer/audio/voice/a.mp3']);
    for (const a of Object.values(createAudioAssetsFromVoiced([], '/trainer/'))) expect(a.url).toMatch(/^\/trainer\/audio\/sfx\//);
  });

  it('skips an id that would not make a safe audio path', () => {
    const m = createAudioAssetsFromVoiced(['../x', 'ok', 'a b', 'c.d', '', 'x/../y'], '/');
    expect(voiceUrls(m)).toEqual(['/audio/voice/ok.mp3']);
    expect(Object.keys(m).some((k) => k.includes('..'))).toBe(false);
  });

  it('an empty list gives only the six sounds', () => {
    expect(Object.keys(createAudioAssetsFromVoiced([], '/'))).toHaveLength(6);
  });

  it('has the same assets as the catalog built from every registered flight', () => {
    const fromList = createAudioAssetsFromVoiced(VOICED_MESSAGE_IDS, '/');
    const fromFlights = createAudioAssets(allScenarios(), '/');
    // Compared as sets: the voiced list is written in cue order, the flight catalog in scenario order.
    expect(Object.keys(fromList).sort()).toEqual(Object.keys(fromFlights).sort());
    expect(fromList).toEqual(fromFlights); // toEqual ignores key order: same urls, types and priorities
  });
});
