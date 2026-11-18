import { expect, it, vi } from 'vitest';
import { EventBus } from '../src/bus/eventBus';
import { bindTrainerAudio } from '../src/xr/audioBinding';
import type { TrainerAudio } from '../src/xr/audio';
import type { WorldCue } from '../src/contracts/events';

function fakeAudio(): TrainerAudio { return { unlock: vi.fn(async () => {}), playMessage: vi.fn(), playSfx: vi.fn(), setPaused: vi.fn(), setAmbient: vi.fn(), setWarning: vi.fn(), reset: vi.fn(), endRun: vi.fn(), dispose: vi.fn() }; }

it('binds messages, warning acknowledgement, clicks and cleanup without dispatching actions', async () => {
  const audio = fakeAudio();
  const bus = new EventBus();
  const actions = vi.fn(); bus.onAction(actions);
  let click!: () => void;
  const offClick = vi.fn();
  const binding = bindTrainerAudio(bus, audio, fn => { click = fn; return offClick; });
  const emit = (body: WorldCue) => bus.emitCue({ t: 0, seq: 0, body });
  const msg: WorldCue = { kind: 'message', id: 'original', channel: 'cabin', text: 'Original text' };
  emit(msg); expect(audio.playMessage).toHaveBeenCalledWith(msg);
  expect(audio.playSfx).toHaveBeenLastCalledWith('chime');
  emit({ kind: 'alert', id: 'warn-one', level: 'warning', text: 'One' });
  emit({ kind: 'alert', id: 'warn-two', level: 'warning', text: 'Two' });
  expect(actions).not.toHaveBeenCalled();
  bus.emitAction({ kind: 'alertAck', alertId: 'warn-one' });
  expect(audio.setWarning).toHaveBeenLastCalledWith(true);
  emit({ kind: 'alertClear', id: 'warn-two' }); expect(audio.setWarning).toHaveBeenLastCalledWith(false);
  emit({ kind: 'alert', id: 'caution', level: 'caution', text: 'Caution' }); expect(audio.playSfx).toHaveBeenLastCalledWith('alert');
  click(); await Promise.resolve(); expect(audio.playSfx).toHaveBeenLastCalledWith('click');
  binding.reset(); expect(audio.reset).toHaveBeenCalledOnce();
  binding.dispose(); emit(msg); expect(audio.playMessage).toHaveBeenCalledOnce(); expect(offClick).toHaveBeenCalledOnce();
  expect(audio.dispose).toHaveBeenCalledOnce();
});


it('keeps a warning pending when an acknowledgement is outside live flow', () => {
  const bus = new EventBus(); const audio = fakeAudio(); let live = false;
  const binding = bindTrainerAudio(bus, audio, undefined, () => live);
  bus.emitCue({ t: 0, seq: 0, body: { kind: 'alert', id: 'warning', level: 'warning', text: 'Original warning' } });
  bus.emitAction({ kind: 'alertAck', alertId: 'warning' });
  expect(audio.setWarning).toHaveBeenLastCalledWith(true);
  live = true; bus.emitAction({ kind: 'alertAck', alertId: 'warning' });
  expect(audio.setWarning).toHaveBeenLastCalledWith(false);
  binding.dispose();
});


it('matches display alert replacement semantics for duplicate and downgraded warnings', () => {
  const bus = new EventBus(); const audio = fakeAudio(); const binding = bindTrainerAudio(bus, audio);
  const warning: WorldCue = { kind: 'alert', id: 'same', level: 'warning', text: 'Original warning' };
  const emit = (body: WorldCue) => bus.emitCue({ t: 0, seq: 0, body });
  emit(warning); bus.emitAction({ kind: 'alertAck', alertId: 'same' }); emit(warning);
  expect(audio.setWarning).toHaveBeenLastCalledWith(false);
  emit({ ...warning, text: 'Changed original warning' }); expect(audio.setWarning).toHaveBeenLastCalledWith(true);
  emit({ ...warning, level: 'caution' }); expect(audio.setWarning).toHaveBeenLastCalledWith(false);
  binding.dispose();
});

it('an unvoiced crew message plays no notification sound', () => {
 const bus = new EventBus(); const audio = fakeAudio(); bindTrainerAudio(bus, audio); bus.emitCue({ t: 0, seq: 0, body: { kind: 'message', channel: 'crew', id: 'crew', text: 'Crew line' } }); expect(audio.playSfx).not.toHaveBeenCalled();
});
