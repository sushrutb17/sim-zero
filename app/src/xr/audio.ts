import type { Channel, WorldCue } from '../contracts/events';
import { THEME, type SfxName as ThemeSfxName } from './theme';

export type MessageCue = Extract<WorldCue, { kind: 'message' }>;
export type SfxName = Exclude<ThemeSfxName, 'ambient' | 'alertWarning'> | 'alert';
export interface PlaybackOptions {
  loop: boolean;
  gainDb: number;
  channel?: Channel;
  onEnded?: () => void;
}
export interface Playback {
  play(): void;
  pause(): void;
  stop(): void;
  dispose(): void;
  setGainDb(db: number): void;
}
/** Only cached buffers may be used by create(); it must never fetch during a run. */
export interface AudioBackend {
  unlock(): Promise<void>;
  create(path: string, options: PlaybackOptions): Playback;
  dispose(): void;
}
export interface TrainerAudio {
  /** Invoke directly in a hand/button gesture. Failure is recoverable on a later gesture. */
  unlock(): Promise<void>;
  playMessage(cue: MessageCue): void;
  playSfx(name: SfxName): void;
  setPaused(paused: boolean): void;
  setAmbient(active: boolean): void;
  setWarning(active: boolean): void;
  /** Clear the old run before restart/redo. Keeps the already-unlocked context usable. */
  reset(): void;
  /** Stop loops and discard pending lines; let the current, audible final line finish. */
  endRun(): void;
  dispose(): void;
}

/** Restrict clips to plain local asset paths, before handing them to any backend. */
export function isAudioPath(path: string | undefined): path is string {
  return !!path && /^\/audio\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:mp3|wav|ogg)$/.test(path);
}

/** Lifecycle and ordering are independent of the renderer and scenario clock. */
export function createTrainerAudio(backend: AudioBackend, opts: { onError?: (error: unknown) => void } = {}): TrainerAudio {
  let disposed = false;
  let unlocked = false;
  let paused = false;
  let ambientWanted = false;
  let warningWanted = false;
  let ending = false;
  let voice: Playback | undefined;
  /** True while `voice` is a first-officer line, which any radio, cabin, dispatch or ground line preempts. */
  let voiceIsCrew = false;
  let ambient: Playback | undefined;
  let warning: Playback | undefined;
  const queue: MessageCue[] = [];
  const oneShots = new Set<Playback>();
  // Error reporting cannot be allowed to interrupt the engine's event bus.
  const report = (error: unknown) => { try { opts.onError?.(error); } catch { /* audio stays optional */ } };
  const stop = (track: Playback | undefined) => {
    if (!track) return;
    try { track.stop(); } catch (e) { report(e); }
    try { track.dispose(); } catch (e) { report(e); }
  };
  const duck = () => ambient?.setGainDb(THEME.sfx.ambient.gainDb + (voice ? THEME.radio.ambientDuckDb : 0));
  function playSfx(name: SfxName) {
    if (disposed || !unlocked || paused) return;
    const token = THEME.sfx[name === 'alert' ? 'alertCaution' : name];
    let track: Playback | undefined;
    try {
      track = backend.create(token.file, { loop: false, gainDb: token.gainDb, onEnded: () => {
        if (track && oneShots.delete(track)) track.dispose();
      } });
      oneShots.add(track);
      track.play();
    } catch (e) {
      if (track) { oneShots.delete(track); stop(track); }
      report(e);
    }
  }
  function startVoice(cue: MessageCue): boolean {
    let next: Playback | undefined;
    try {
      next = backend.create(cue.audio!, { loop: false, gainDb: THEME.radio.voiceGainDb, channel: cue.channel, onEnded: () => {
        // Old completions must never advance a newer run.
        if (voice !== next) return;
        voice = undefined;
        next!.dispose();
        duck();
        pump();
      } });
      voice = next;
      voiceIsCrew = cue.channel === 'crew';
      duck();
      if (cue.channel !== 'crew') playSfx(cue.channel === 'cabin' ? 'chime' : 'radioIn');
      next.play();
      return true;
    } catch (e) {
      voice = undefined;
      stop(next);
      duck();
      report(e);
      return false;
    }
  }
  function pump() {
    if (disposed || ending || !unlocked || paused || voice) return;
    while (queue.length) if (startVoice(queue.shift()!)) return;
    duck();
  }
  function updateLoops() {
    if (disposed || ending || !unlocked || paused) return;
    if (ambientWanted && !ambient) {
      try {
        ambient = backend.create(THEME.sfx.ambient.file, { loop: true, gainDb: THEME.sfx.ambient.gainDb });
        duck(); ambient.play();
      } catch (e) { stop(ambient); ambient = undefined; report(e); }
    }
    if (warningWanted && !warning) {
      try {
        warning = backend.create(THEME.sfx.alertWarning.file, { loop: true, gainDb: THEME.sfx.alertWarning.gainDb });
        warning.play();
      } catch (e) { stop(warning); warning = undefined; report(e); }
    }
  }
  function reset() {
    queue.length = 0;
    const oldVoice = voice; voice = undefined;
    const oldAmbient = ambient; ambient = undefined;
    const oldWarning = warning; warning = undefined;
    ambientWanted = warningWanted = false;
    ending = false;
    paused = false;
    stop(oldVoice); stop(oldAmbient); stop(oldWarning);
    const shots = [...oneShots]; oneShots.clear(); shots.forEach(stop);
  }
  return {
    unlock() {
      if (disposed) return Promise.resolve();
      // Every call reaches backend.unlock() synchronously, because that call (context.resume()) is what uses the
      // gesture's user activation. An earlier unlock that never settles (Chrome keeps resume() pending without
      // activation) must not swallow later gestures, so no pending promise is reused (T49).
      try {
        return backend.unlock().then(() => {
          if (disposed || unlocked) return; // the locked to unlocked change happens once
          unlocked = true; updateLoops(); pump();
        }).catch(report);
      } catch (e) { report(e); return Promise.resolve(); }
    },
    playMessage(cue) {
      if (disposed || ending || !unlocked || !isAudioPath(cue.audio)) return;
      if (cue.channel === 'crew') {
        if (!paused && !voice && queue.length === 0) startVoice(cue);
        return;
      }
      // ATC does not wait for the cockpit: an arriving transmission stops a first-officer line (its caption stays).
      if (voice && voiceIsCrew) { const old = voice; voice = undefined; voiceIsCrew = false; stop(old); }
      if (queue.length >= 2) queue.shift(); // Retain only the freshest two pending transmissions.
      queue.push({ ...cue }); pump();
    },
    playSfx,
    setPaused(value) {
      if (disposed || paused === value) return;
      paused = value;
      if (value) {
        voice?.pause(); ambient?.pause(); warning?.pause();
        const shots = [...oneShots]; oneShots.clear(); shots.forEach(stop);
      } else if (unlocked) {
        voice?.play(); ambient?.play(); warning?.play(); updateLoops(); pump();
      }
    },
    setAmbient(active) {
      if (disposed) return;
      ambientWanted = active;
      if (!active) { const old = ambient; ambient = undefined; stop(old); }
      updateLoops();
    },
    setWarning(active) {
      if (disposed) return;
      warningWanted = active;
      if (!active) { const old = warning; warning = undefined; stop(old); }
      updateLoops();
    },
    endRun() {
      if (disposed) return;
      ending = true; queue.length = 0;
      ambientWanted = warningWanted = false;
      const oldAmbient = ambient; ambient = undefined;
      const oldWarning = warning; warning = undefined;
      stop(oldAmbient); stop(oldWarning);
      // A line paused at termination must never reappear on a later run.
      if (paused) { const oldVoice = voice; voice = undefined; stop(oldVoice); }
    },
    reset() { if (!disposed) reset(); },
    dispose() {
      if (disposed) return;
      disposed = true; reset(); backend.dispose();
    },
  };
}
