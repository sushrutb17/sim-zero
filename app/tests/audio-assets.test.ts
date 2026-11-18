import { describe, expect, it, vi } from 'vitest';
import { VOICED_MESSAGE_IDS } from '../src/scenarios/single-source.voice';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THEME } from '../src/xr/theme';
import { isAudioPath } from '../src/xr/audio';
import { allScenarios } from '../src/scenarios/registry';
import { createAudioAssets } from '../src/xr/audioAssets';
vi.mock('@iwsdk/core', () => ({ AssetType: { Audio: 'audio' } }));

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const ledger = readFileSync(new URL('../../docs/asset-ledger.md', import.meta.url), 'utf8');
describe('original audio assets', () => {
  it('preloads audio before welcome and respects a hosted subpath', () => {
    const manifest = createAudioAssets(undefined, '/trainer/');
    expect(Object.keys(manifest)).toHaveLength(6);
    for (const asset of Object.values(manifest)) {
      expect(asset.priority).toBe('critical'); expect(asset.url).toMatch(/^\/trainer\/audio\/sfx\//);
    }
  });
  it('registers configured voice clips as lazy (loaded after welcome) while SFX remain critical', () => {
    // Every voiced message of every registered flight (VOICED_MESSAGE_IDS, generated) is one lazy entry (none is background, so preloadAssets starts no voice download); the six SFX stay critical.
    const assets = Object.values(createAudioAssets(allScenarios(), '/'));
    const lazy = assets.filter(a => a.priority === 'lazy');
    expect(assets.filter(a => (a.priority as string) === 'background')).toHaveLength(0);
    expect(lazy.map(a => a.url).sort()).toEqual(VOICED_MESSAGE_IDS.map(id => `/audio/voice/${id}.mp3`).sort());
    expect(lazy.length).toBeGreaterThan(0);
    expect(assets.filter(a => a.priority === 'critical')).toHaveLength(6);
  });
  it('ships every theme SFX as a nonempty file, entirely under /audio/', () => {
    for (const token of Object.values(THEME.sfx)) {
      expect(isAudioPath(token.file)).toBe(true);
      expect(statSync(publicDir + token.file).size).toBeGreaterThan(0);
    }
  });
  it('ledgers every file in public/audio/sfx', () => {
    for (const file of readdirSync(publicDir + '/audio/sfx')) expect(ledger).toContain('`' + file + '`');
  });
  it('keeps all prepared SFX below the full 15 MB audio budget', () => {
    const total = readdirSync(publicDir + '/audio/sfx').reduce((sum, file) => sum + statSync(publicDir + '/audio/sfx/' + file).size, 0);
    expect(total).toBeLessThanOrEqual(15_000_000);
  });
});
