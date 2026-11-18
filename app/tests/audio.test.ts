import { describe, expect, it, vi } from 'vitest';
import { createTrainerAudio, type AudioBackend, type Playback, type PlaybackOptions } from '../src/xr/audio';
import type { WorldCue } from '../src/contracts/events';
import { THEME } from '../src/xr/theme';

type Message = Extract<WorldCue, { kind: 'message' }>;
const message = (id: string, channel: Message['channel'] = 'atc'): Message => ({ kind: 'message', id, channel, text: `Original ${id}`, audio: `/audio/voice/${id}.mp3` });
function setup() {
  const tracks: Array<Playback & { path: string; options: PlaybackOptions; finish(): void }> = [];
  const create = vi.fn((path: string, options: PlaybackOptions) => {
    const track = { path, options, play: vi.fn(), pause: vi.fn(), stop: vi.fn(), dispose: vi.fn(), setGainDb: vi.fn(), finish: () => options.onEnded?.() };
    tracks.push(track);
    return track;
  });
  const backend: AudioBackend = { unlock: vi.fn(async () => {}), dispose: vi.fn(), create };
  const errors = vi.fn();
  return { audio: createTrainerAudio(backend, { onError: errors }), backend, tracks, errors };
}

describe('audio lifecycle', () => {
  it('drops locked messages, then serializes fresh radio messages after unlock', async () => {
    const { audio, tracks } = setup();
    audio.playMessage(message('stale'));
    expect(tracks).toHaveLength(0);
    await audio.unlock();
    expect(tracks).toHaveLength(0);
    audio.playMessage(message('one')); audio.playMessage(message('two'));
    const one = tracks.find(t => t.path.endsWith('/one.mp3'))!;
    expect(one.play).toHaveBeenCalledOnce();
    expect(tracks.some(t => t.path.endsWith('/two.mp3'))).toBe(false);
    one.finish();
    expect(tracks.find(t => t.path.endsWith('/two.mp3'))?.play).toHaveBeenCalledOnce();
    expect(one.dispose).toHaveBeenCalledOnce();
  });
  it('pauses voice and ambience, drops clicks while paused, resumes the same voice', async () => {
    const { audio, tracks } = setup();
    await audio.unlock(); audio.setAmbient(true); audio.playMessage(message('one'));
    const voice = tracks.find(t => t.path.endsWith('/one.mp3'))!;
    const ambient = tracks.find(t => t.path === THEME.sfx.ambient.file)!;
    audio.setPaused(true);
    expect(voice.pause).toHaveBeenCalledOnce(); expect(ambient.pause).toHaveBeenCalledOnce();
    const n = tracks.length; audio.playSfx('click'); expect(tracks).toHaveLength(n);
    audio.playMessage(message('two')); audio.setPaused(false);
    expect(voice.play).toHaveBeenCalledTimes(2);
    expect(tracks.some(t => t.path.endsWith('/two.mp3'))).toBe(false);
  });
  it('ducks ambience during voice and restores it at end, using theme tokens', async () => {
    const { audio, tracks } = setup(); await audio.unlock(); audio.setAmbient(true);
    const ambient = tracks[0]; audio.playMessage(message('one'));
    expect(ambient.setGainDb).toHaveBeenLastCalledWith(THEME.sfx.ambient.gainDb + THEME.radio.ambientDuckDb);
    tracks.find(t => t.path.endsWith('/one.mp3'))!.finish();
    expect(ambient.setGainDb).toHaveBeenLastCalledWith(THEME.sfx.ambient.gainDb);
  });
  it('reset discards queued and active speech; late callbacks cannot replay it', async () => {
    const { audio, tracks } = setup(); await audio.unlock();
    audio.playMessage(message('old')); audio.playMessage(message('stale'));
    const old = tracks.find(t => t.path.endsWith('/old.mp3'))!; audio.reset(); old.finish();
    expect(old.stop).toHaveBeenCalledOnce(); expect(old.dispose).toHaveBeenCalledOnce();
    expect(tracks.some(t => t.path.endsWith('/stale.mp3'))).toBe(false);
    audio.playMessage(message('redo')); expect(tracks.find(t => t.path.endsWith('/redo.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('does not leak pending unlock work after dispose', async () => {
    const { audio, backend, tracks } = setup();
    let done!: () => void;
    vi.mocked(backend.unlock).mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
    audio.playMessage(message('old')); const unlocking = audio.unlock(); audio.dispose(); done(); await unlocking;
    audio.playMessage(message('ignored')); audio.playSfx('click'); audio.setAmbient(true);
    expect(tracks).toHaveLength(0); expect(backend.dispose).toHaveBeenCalledOnce();
  });
  it('missing or unsafe clips leave text-only messages and never load external URLs', async () => {
    const { audio, tracks } = setup(); await audio.unlock();
    for (const audioPath of [undefined, '/outside.mp3', '/audio/../outside.mp3', '/audio/%2e%2e/secret.mp3', 'https://invalid.example/a.mp3', '/audio/a.mp3?q=x', '/audio/voice/\\evil.mp3'])
      audio.playMessage({ ...message('test'), audio: audioPath });
    expect(tracks).toHaveLength(0);
  });
  it('recovers from unavailable buffers without blocking the next message', async () => {
    const { audio, backend, tracks, errors } = setup(); await audio.unlock();
    const original = vi.mocked(backend.create).getMockImplementation()!;
    vi.mocked(backend.create).mockImplementation((path, options) => {
      if (path.endsWith('/missing.mp3')) throw new Error('missing');
      return original(path, options);
    });
    audio.playMessage(message('missing')); audio.playMessage(message('next'));
    expect(errors).toHaveBeenCalled(); expect(tracks.find(t => t.path.endsWith('/next.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('a clip that has not been loaded yet is reported, not thrown, and a later message plays its clip once it is loaded (T45)', async () => {
    const { audio, backend, tracks, errors } = setup(); await audio.unlock();
    const loaded = new Set<string>();
    const original = vi.mocked(backend.create).getMockImplementation()!;
    // The real backend throws 'Audio buffer not preloaded' while AssetManager.getAudio(id) is empty.
    vi.mocked(backend.create).mockImplementation((path, options) => {
      if (path.startsWith('/audio/voice/') && !loaded.has(path)) throw new Error(`Audio buffer not preloaded: ${path}`);
      return original(path, options);
    });
    expect(() => audio.playMessage(message('early'))).not.toThrow();
    expect(tracks).toHaveLength(0); // no clip, no radio tone: the line stays a caption (the comms panel shows it independently)
    expect(errors).toHaveBeenCalledOnce();
    loaded.add('/audio/voice/later.mp3');
    audio.playMessage(message('later'));
    const later = tracks.find(t => t.path === '/audio/voice/later.mp3')!;
    expect(later.play).toHaveBeenCalledOnce();
    expect(tracks.some(t => t.path === THEME.sfx.radioIn.file)).toBe(true); // the incoming tone accompanies a clip that plays
    expect(errors).toHaveBeenCalledOnce();
    later.finish();
    audio.playMessage(message('early')); // still not loaded: reported again, nothing blocks the queue
    expect(errors).toHaveBeenCalledTimes(2);
    loaded.add('/audio/voice/early.mp3');
    audio.playMessage(message('early'));
    expect(tracks.find(t => t.path === '/audio/voice/early.mp3')?.play).toHaveBeenCalledOnce();
  });
  it('rechecks the shared context on later gestures without replaying an active line', async () => {
    const { audio, backend, tracks } = setup(); await audio.unlock();
    audio.playMessage(message('one')); const count = tracks.length;
    await audio.unlock();
    expect(backend.unlock).toHaveBeenCalledTimes(2); expect(tracks).toHaveLength(count);
  });
  it('keeps only the freshest two pending messages behind the active line', async () => {
    const { audio, tracks } = setup(); await audio.unlock();
    for (const id of ['one', 'two', 'three', 'four']) audio.playMessage(message(id));
    tracks.find(t => t.path.endsWith('/one.mp3'))!.finish();
    expect(tracks.some(t => t.path.endsWith('/two.mp3'))).toBe(false);
    expect(tracks.find(t => t.path.endsWith('/three.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('ends loops and queued speech while allowing the current final line to finish', async () => {
    const { audio, tracks } = setup(); await audio.unlock(); audio.setAmbient(true); audio.setWarning(true);
    audio.playMessage(message('final')); audio.playMessage(message('queued'));
    const final = tracks.find(t => t.path.endsWith('/final.mp3'))!;
    audio.endRun(); expect(final.stop).not.toHaveBeenCalled();
    expect(tracks.find(t => t.path === THEME.sfx.ambient.file)?.stop).toHaveBeenCalledOnce();
    expect(tracks.find(t => t.path === THEME.sfx.alertWarning.file)?.stop).toHaveBeenCalledOnce();
    final.finish(); expect(final.dispose).toHaveBeenCalledOnce();
    expect(tracks.some(t => t.path.endsWith('/queued.mp3'))).toBe(false);
    audio.playMessage(message('late')); expect(tracks.some(t => t.path.endsWith('/late.mp3'))).toBe(false);
    audio.reset(); audio.playMessage(message('redo')); expect(tracks.find(t => t.path.endsWith('/redo.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('recovers from a failed unlock on a later gesture, without retaining locked speech', async () => {
    const { audio, backend, tracks, errors } = setup();
    vi.mocked(backend.unlock).mockRejectedValueOnce(new Error('gesture required'));
    await audio.unlock(); audio.playMessage(message('stale')); expect(errors).toHaveBeenCalled();
    await audio.unlock(); expect(tracks).toHaveLength(0);
    audio.playMessage(message('fresh')); expect(tracks.find(t => t.path.endsWith('/fresh.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('T49: a later gesture calls backend.unlock again, synchronously, even while an earlier unlock never settles', async () => {
    const { audio, backend, tracks } = setup();
    // Chrome keeps resume() pending when the page has no user activation: the first unlock never settles.
    vi.mocked(backend.unlock).mockImplementationOnce(() => new Promise<void>(() => {}));
    void audio.unlock();
    expect(backend.unlock).toHaveBeenCalledTimes(1);
    audio.playMessage(message('early')); expect(tracks).toHaveLength(0); // still locked
    const second = audio.unlock();
    expect(backend.unlock).toHaveBeenCalledTimes(2); // not short-circuited by the hanging first call
    await second;
    audio.playMessage(message('now')); expect(tracks.find(t => t.path.endsWith('/now.mp3'))?.play).toHaveBeenCalledOnce();
  });
  it('T49: starts queued loops once on the locked to unlocked change, however many unlocks resolve', async () => {
    const { audio, backend, tracks } = setup();
    const settle: Array<() => void> = [];
    vi.mocked(backend.unlock).mockImplementation(() => new Promise<void>(resolve => { settle.push(resolve); }));
    audio.setAmbient(true);
    const a = audio.unlock(); const b = audio.unlock();
    expect(backend.unlock).toHaveBeenCalledTimes(2);
    settle.forEach(f => f()); await Promise.all([a, b]);
    expect(tracks.filter(t => t.path === THEME.sfx.ambient.file)).toHaveLength(1);
  });
  it('T49: a failure of one pending unlock is reported, not thrown, and does not block a later success', async () => {
    const { audio, backend, errors } = setup();
    let fail!: (e: unknown) => void;
    vi.mocked(backend.unlock).mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const first = audio.unlock(); const second = audio.unlock();
    fail(new Error('no gesture')); await expect(first).resolves.toBeUndefined(); await second;
    expect(errors).toHaveBeenCalledOnce();
  });
  it('does not start loops if unlocked while paused, and reset removes the paused run', async () => {
    const { audio, tracks } = setup(); audio.setAmbient(true); audio.setPaused(true); await audio.unlock();
    expect(tracks).toHaveLength(0); audio.playMessage(message('old')); audio.reset(); audio.setPaused(false);
    expect(tracks).toHaveLength(0);
  });
  it('uses cabin chime and radio squelch for the corresponding voiced channels', async () => {
    const { audio, tracks } = setup(); await audio.unlock(); audio.playMessage(message('cabin', 'cabin'));
    expect(tracks.some(t => t.path === THEME.sfx.chime.file)).toBe(true);
    audio.reset(); const n = tracks.length; audio.playMessage(message('atc', 'atc'));
    expect(tracks.slice(n).some(t => t.path === THEME.sfx.radioIn.file)).toBe(true);
  });
  it('keeps warning loop unique and stops it when acknowledged', async () => {
    const { audio, tracks } = setup(); await audio.unlock();
    audio.setWarning(true); audio.setWarning(true);
    const warning = tracks.filter(t => t.path === THEME.sfx.alertWarning.file);
    expect(warning).toHaveLength(1); expect(warning[0].options.loop).toBe(true);
    audio.setWarning(false); expect(warning[0].stop).toHaveBeenCalledOnce();
  });
});

describe('crew voice priority', () => {
 it('speaks idle crew without a tone; incoming radio stops the crew line and plays at once (ATC does not wait)', async () => {
 const { audio, tracks } = setup(); await audio.unlock(); audio.playMessage(message('crew', 'crew'));
 expect(tracks.map(t => t.path)).toEqual(['/audio/voice/crew.mp3']); audio.playMessage(message('radio'));
 expect(tracks[0].stop).toHaveBeenCalledOnce();
 const radio = tracks.find(t => t.path.endsWith('/radio.mp3')); expect(radio?.play).toHaveBeenCalledOnce();
 expect(tracks.some(t => t.path === THEME.sfx.radioIn.file)).toBe(true);
 });
 it('a stale end of the stopped crew line does not cut or advance the radio', async () => {
 const { audio, tracks } = setup(); await audio.unlock(); audio.playMessage(message('crew', 'crew')); audio.playMessage(message('one')); audio.playMessage(message('two'));
 tracks[0].finish();
 const one = tracks.find(t => t.path.endsWith('/one.mp3'))!; expect(one.stop).not.toHaveBeenCalled(); expect(tracks.some(t => t.path.endsWith('/two.mp3'))).toBe(false);
 one.finish(); expect(tracks.find(t => t.path.endsWith('/two.mp3'))?.play).toHaveBeenCalledOnce();
 });
 it('radio arriving while paused during a crew line drops the crew line and plays on resume', async () => {
 const { audio, tracks } = setup(); await audio.unlock(); audio.playMessage(message('crew', 'crew')); audio.setPaused(true); audio.playMessage(message('radio'));
 expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(tracks.some(t => t.path.endsWith('/radio.mp3'))).toBe(false);
 audio.setPaused(false); expect(tracks[0].play).toHaveBeenCalledOnce(); expect(tracks.find(t => t.path.endsWith('/radio.mp3'))?.play).toHaveBeenCalledOnce();
 });
 it('drops busy crew without interrupting or displacing queued radios', async () => {
 const { audio, tracks } = setup(); await audio.unlock(); for (const id of ['one', 'two', 'three']) audio.playMessage(message(id)); audio.playMessage(message('crew', 'crew'));
 const one = tracks.find(t => t.path.endsWith('/one.mp3'))!; expect(one.stop).not.toHaveBeenCalled(); one.finish();
 const two = tracks.find(t => t.path.endsWith('/two.mp3'))!; expect(two).toBeDefined(); two.finish(); expect(tracks.some(t => t.path.endsWith('/three.mp3'))).toBe(true); expect(tracks.some(t => t.path.endsWith('/crew.mp3'))).toBe(false);
 });
 it('drops locked and paused crew permanently', async () => {
 const { audio, tracks } = setup(); audio.playMessage(message('locked', 'crew')); await audio.unlock(); audio.setPaused(true); audio.playMessage(message('paused', 'crew')); audio.setPaused(false); expect(tracks).toHaveLength(0);
 });
});

it('restores ambient gain when direct crew playback fails after ducking', async () => {
 const { audio, backend, tracks } = setup(); await audio.unlock(); audio.setAmbient(true);
 const original = vi.mocked(backend.create).getMockImplementation()!;
 vi.mocked(backend.create).mockImplementationOnce((path, options) => {
   const track = original(path, options); vi.mocked(track.play).mockImplementation(() => { throw new Error('play failed'); }); return track;
 });
 audio.playMessage(message('crew', 'crew'));
 expect(tracks[0].setGainDb).toHaveBeenLastCalledWith(THEME.sfx.ambient.gainDb);
});
