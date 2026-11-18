import { expect, it, vi } from 'vitest';
const sounds: FakeAudio[] = [];
class FakeAudio {
  name = ''; isPlaying = false;
  gain = { gain: { setTargetAtTime: vi.fn() }, disconnect: vi.fn() };
  panner = { disconnect: vi.fn() };
  setBuffer = vi.fn(() => this); setLoop = vi.fn(() => this); setVolume = vi.fn(() => this);
  setRefDistance = vi.fn(() => this); setRolloffFactor = vi.fn(() => this); setFilters = vi.fn();
  getFilters = () => []; onEnded() {} play() {} pause() {} stop() {} disconnect() {} removeFromParent() {}
  constructor() { sounds.push(this); }
}
vi.doMock('@iwsdk/core', () => ({ AssetManager: { getAudio: () => ({}) }, Audio: class extends FakeAudio {}, PositionalAudio: class extends FakeAudio {} }));
it('crew is an unfiltered positional source at the right-seat anchor', async () => {
  const { createAudioBackend } = await import('../src/xr/audioBackend');
  const listener = { context: { createBiquadFilter: vi.fn(), createDynamicsCompressor: vi.fn() }, add: vi.fn() };
  const comms = { add: vi.fn() }; const crew = { add: vi.fn() };
  createAudioBackend(listener as never, comms as never, crew as never).create('/audio/voice/crew.mp3', { channel: 'crew', loop: false, gainDb: 0 });
  const sound = sounds[0]; expect(crew.add).toHaveBeenCalledWith(sound); expect(comms.add).not.toHaveBeenCalled();
  expect(sound.setRefDistance).toHaveBeenCalledWith(1); expect(sound.setRolloffFactor).toHaveBeenCalledWith(0.35);
  expect(sound.setFilters).not.toHaveBeenCalled(); expect(listener.context.createBiquadFilter).not.toHaveBeenCalled(); expect(listener.context.createDynamicsCompressor).not.toHaveBeenCalled();
});
