import { AssetManager, Audio, PositionalAudio, type AudioListener, type Object3D } from '@iwsdk/core';
import type { AudioBackend, PlaybackOptions } from './audio';
import { audioAssetId } from './audioAssets';
import { THEME } from './theme';

/**
 * Reuses the app's listener (do not create a second listener). Radio sources follow
 * the comms panel. SFX/ambience are non-positional. Missing cached buffers throw;
 * the lifecycle layer reports them and keeps the visible message usable.
 */
export function createAudioBackend(listener: AudioListener, commsPanel: Object3D, crewSeat: Object3D): AudioBackend {
  const owned = new Set<Audio<AudioNode>>();
  return {
    async unlock() {
      if (listener.context.state !== 'running') await listener.context.resume();
      if (listener.context.state !== 'running') throw new Error('Audio requires a new hand gesture to unlock.');
    },
    create(path: string, options: PlaybackOptions) {
      const buffer = AssetManager.getAudio(audioAssetId(path));
      if (!buffer) throw new Error(`Audio buffer not preloaded: ${path}`);
      const sound = options.channel ? new PositionalAudio(listener) : new Audio(listener);
      sound.name = `trainer-audio:${path}`;
      sound.setBuffer(buffer).setLoop(options.loop).setVolume(10 ** (options.gainDb / 20));
      const filters: AudioNode[] = [];
      if (sound instanceof PositionalAudio) {
        sound.setRefDistance(1).setRolloffFactor(0.35);
        if (options.channel !== 'crew') {
          const cabin = options.channel === 'cabin';
          const low = listener.context.createBiquadFilter(); low.type = 'highpass';
          low.frequency.value = cabin ? THEME.radio.cabinBandLowHz : THEME.radio.bandLowHz;
          const high = listener.context.createBiquadFilter(); high.type = 'lowpass';
          high.frequency.value = cabin ? THEME.radio.cabinBandHighHz : THEME.radio.bandHighHz;
          const compressor = listener.context.createDynamicsCompressor();
          compressor.ratio.value = THEME.radio.compressorRatio;
          compressor.attack.value = THEME.radio.compressorAttackS;
          compressor.release.value = THEME.radio.compressorReleaseS;
          filters.push(low, high, compressor); sound.setFilters(filters);
        }
      }
      (options.channel === 'crew' ? crewSeat : options.channel ? commsPanel : listener).add(sound);
      owned.add(sound);
      let disposed = false;
      const ended = sound.onEnded.bind(sound);
      sound.onEnded = () => { ended(); if (!disposed) options.onEnded?.(); };
      return {
        play() { if (!disposed && !sound.isPlaying) sound.play(); },
        pause() { if (!disposed && sound.isPlaying) sound.pause(); },
        stop() { if (!disposed) sound.stop(); },
        setGainDb(db: number) {
          if (disposed) return;
          // A short gain ramp avoids clicks when ducking/restoring the ambient bed.
          sound.gain.gain.setTargetAtTime(10 ** (db / 20), listener.context.currentTime, 0.025);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (sound.isPlaying) sound.stop();
          sound.disconnect(); filters.forEach(filter => filter.disconnect());
          sound.gain.disconnect();
          if (sound instanceof PositionalAudio) sound.panner.disconnect();
          sound.removeFromParent(); owned.delete(sound);
        },
      };
    },
    dispose() {
      // TrainerAudio normally releases its tracks first. This also covers partial construction.
      for (const sound of owned) {
        if (sound.isPlaying) sound.stop();
        sound.disconnect(); sound.getFilters().forEach(filter => filter.disconnect());
        sound.gain.disconnect();
        if (sound instanceof PositionalAudio) sound.panner.disconnect();
        sound.removeFromParent();
      }
      owned.clear();
      // The shared listener/context belong to IWSDK, so leave them open.
    },
  };
}
