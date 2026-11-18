/** Deterministic shared catalog: audio is loaded before the welcome screen; cockpit geometry is procedural. */
import { defineAssets } from '@iwsdk/core';
import { VOICED_MESSAGE_IDS } from './scenarios/single-source.voice';
import { createAudioAssetsFromVoiced } from './xr/audioAssets';

// The catalog comes from the generated voiced list (tools/gen-voice.mjs), so no scenario is built at start-up. Every flight's and
// variation's voice clips are in it, the first flight's baseline first. They are registered as lazy: preloadAssets loads only the
// sounds the welcome screen needs, and src/index.ts loads the clips itself, a few at a time, once the welcome screen is drawn
// (src/xr/voiceLoader.ts). A line whose clip has not arrived plays as a caption only.
export default defineAssets(createAudioAssetsFromVoiced(VOICED_MESSAGE_IDS));
