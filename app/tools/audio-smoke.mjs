// Dev-only backend probe: generated waveforms, not speech or a simulated scenario.
import { AssetManager, AudioListener } from '@iwsdk/core';
import { createTrainerAudio } from '../src/xr/audio';
import { createAudioBackend } from '../src/xr/audioBackend';
import { createAudioAssets, audioAssetId } from '../src/xr/audioAssets';
import { THEME } from '../src/xr/theme';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function prepareAudioSmoke() {
  const manifest = createAudioAssets();
  AssetManager.registerManifest(manifest);
  await Promise.all(Object.keys(manifest).map(id => AssetManager.loadAudioById(id)));
  const head = AssetManager.world.player.head;
  let listener;
  head.traverse(node => { if (node instanceof AudioListener) listener = node; });
  if (!listener) throw new Error('IWSDK AudioListener not found on player head.');
  const audioErrors = [];
  // Head anchor only for inspection; integration uses the comms panel.
  const audio = createTrainerAudio(createAudioBackend(listener, head), { onError: e => audioErrors.push(String(e)) });
  const sounds = () => {
    const tracks = [];
    head.traverse(node => { if (node.name.startsWith('trainer-audio:')) tracks.push(node); });
    return tracks;
  };
  const result = { context: '', decoded: {}, started: false, paused: false, resumed: false, reset: false, queueDrained: false, errors: audioErrors };
  for (const token of Object.values(THEME.sfx)) {
    const buffer = AssetManager.getAudio(audioAssetId(token.file));
    let peak = 0;
    for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
    if (peak === 0 || peak >= 1) throw new Error(`Silent/clipped decoded file: ${token.file}`);
    result.decoded[token.file] = { duration: buffer.duration, peak };
  }
  const button = document.createElement('button');
  button.textContent = 'Run isolated audio check';
  button.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;pointer-events:auto';
  document.body.append(button);
  let settle;
  const completion = new Promise(resolve => { settle = resolve; });
  button.addEventListener('click', () => {
    const unlocked = audio.unlock(); // Synchronous within a real browser gesture.
    void (async () => {
      try {
        await unlocked;
        audio.setAmbient(true);
        audio.playMessage({ kind: 'message', id: 'probe-waveform', channel: 'atc', text: 'Original waveform probe only', audio: THEME.sfx.chime.file });
        await delay(120);
        result.context = listener.context.state;
        result.started = sounds().filter(sound => sound.isPlaying).length >= 2;
        audio.setPaused(true); result.paused = sounds().every(sound => !sound.isPlaying);
        await delay(60);
        audio.setPaused(false); result.resumed = sounds().filter(sound => sound.isPlaying).length >= 2;
        audio.reset(); result.reset = sounds().length === 0;
        audio.playMessage({ kind: 'message', id: 'probe-one', channel: 'cabin', text: 'Waveform one', audio: THEME.sfx.chime.file });
        audio.playMessage({ kind: 'message', id: 'probe-two', channel: 'dispatch', text: 'Waveform two', audio: THEME.sfx.chime.file });
        await delay(1500);
        result.queueDrained = sounds().length === 0;
      } catch (error) { audioErrors.push(String(error)); }
      finally { audio.dispose(); button.remove(); settle(result); }
    })();
  }, { once: true });
  return completion;
}
