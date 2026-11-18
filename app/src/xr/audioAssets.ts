import { AssetType } from '@iwsdk/core';
import type { Scenario } from '../contracts/scenario';
import { THEME } from './theme';
import { isAudioPath } from './audio';

const AUDIO_ID_PREFIX = 'trainer-audio:';
export const audioAssetId = (path: string): string => `${AUDIO_ID_PREFIX}${path}`;

const VOICE_PREFIX = '/audio/voice/';

/** One catalog entry per path (in the order given): voice clips are registered but lazy (src/xr/voiceLoader.ts loads them after the welcome screen), the sounds are critical. */
function catalog(paths: Iterable<string>, baseUrl: string) {
  return Object.fromEntries([...new Set(paths)].map(path => [audioAssetId(path), {
    url: `${baseUrl.replace(/\/$/, '')}${path}`, type: AssetType.Audio, priority: path.startsWith(VOICE_PREFIX) ? 'lazy' as const : 'critical' as const,
  }]));
}

const sfxPaths = (): string[] => Object.values(THEME.sfx).map(token => token.file);

/** Spread into defineAssets() at integration. Deterministic in both editor/runtime realms. One scenario, or every flight's (T41): each clip is listed once, in the order given. */
export function createAudioAssets(scenarios?: Scenario | readonly Scenario[], baseUrl = import.meta.env.BASE_URL) {
  const paths = sfxPaths();
  const list: readonly Scenario[] = scenarios === undefined ? [] : 'eventSets' in scenarios ? [scenarios] : scenarios;
  for (const scenario of list) {
    const cues = scenario.eventSets.flatMap(es => [...es.startCues, ...es.rules.flatMap(rule => rule.cues)]);
    cues.push(scenario.softTimeout.promptCue);
    for (const cue of cues) if (cue.kind === 'message' && isAudioPath(cue.audio)) paths.push(cue.audio);
  }
  return catalog(paths, baseUrl);
}

/**
 * The same catalog built from the generated list of voiced message ids (src/scenarios/single-source.voice.ts), without building
 * any scenario: the sounds first (critical), then each id's clip in the order given (lazy). An id that does not make a
 * safe audio path is skipped.
 */
export function createAudioAssetsFromVoiced(voicedIds: readonly string[], baseUrl = import.meta.env.BASE_URL) {
  const voice = voicedIds.map(id => `${VOICE_PREFIX}${id}.mp3`).filter(path => isAudioPath(path));
  return catalog([...sfxPaths(), ...voice], baseUrl);
}

/** The ids of the voice clips of a catalog, in catalog order (the sounds are not included). */
export function voiceAssetIds(assets: Readonly<Record<string, { url: string }>>): string[] {
  return Object.keys(assets).filter(id => id.startsWith(`${AUDIO_ID_PREFIX}${VOICE_PREFIX}`));
}
