import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/eventBus';
import { parseScenario } from '../../src/contracts/scenario';
import { TrainerApp } from '../../src/app/controller';
import { bindTrainerAudio } from '../../src/xr/audioBinding';
import type { TrainerAudio } from '../../src/xr/audio';
import { AlertsModel } from '../../src/xr/displays/alerts';
import { miniScenario } from '../fixtures/mini-scenario';

function setup() {
  const log: string[] = [];
  const bus = new EventBus();
  const audio: TrainerAudio = {
    unlock: vi.fn(async () => { log.push('unlock'); }),
    playMessage: vi.fn(cue => { log.push(`message:${cue.id}`); }),
    playSfx: vi.fn(), setWarning: vi.fn(),
    setPaused: vi.fn(paused => { log.push(`paused:${paused}`); }),
    setAmbient: vi.fn(active => { log.push(`ambient:${active}`); }),
    reset: vi.fn(() => { log.push('audio.reset'); }), endRun: vi.fn(), dispose: vi.fn(),
  };
  const alerts = new AlertsModel();
  bus.onCue(({ body }) => alerts.apply(body));
  const binding = bindTrainerAudio(bus, audio);
  let now = 100;
  const app = new TrainerApp({ scenario: parseScenario(structuredClone(miniScenario)), bus, nowMs: () => now,
    controls: new Map(),
    panels: { handleCue: vi.fn(), setScenario: vi.fn(), setAircraft: vi.fn(), setLive: vi.fn(), reset: vi.fn(), onPause: vi.fn() },
    displays: { setAircraft: vi.fn(), resetAlerts: () => alerts.reset(), setAirportNames: vi.fn(), setLive: (live: boolean) => { alerts.live = live; } },
    audio: { ...audio, reset: binding.reset, endRun: binding.endRun, dispose: binding.dispose },
  });
  const tick = () => { for (let i = 0; i < 6; i++) app.frame(0.1); };
  const begin = () => { app.continue(); app.chooseAuto(); bus.emitAction({ kind: 'control', controlId: 'practice.toggle', value: true }); app.begin(); tick(); };
  const end = () => {
    bus.emitAction({ kind: 'reply', messageId: 'msg-a1', cardId: 'card-yes' });
    bus.emitAction({ kind: 'control', controlId: 'lights.landing', value: true }); tick();
    bus.emitAction({ kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(app.state).toBe('debrief');
  };
  return { app, audio, bus, binding, alerts, log, begin, end, tick, setNow: (value: number) => { now = value; } };
}

describe('app/audio lifecycle integration', () => {
  it('unlocks on hand-driven flow events and starts ambience only for the running scenario', () => {
    const r = setup();
    expect(r.audio.setAmbient).not.toHaveBeenCalledWith(true);
    r.app.continue(); expect(r.audio.unlock).toHaveBeenCalled();
    r.app.chooseAuto(); r.bus.emitAction({ kind: 'control', controlId: 'practice.toggle', value: true });
    expect(r.audio.setAmbient).not.toHaveBeenCalledWith(true);
    r.app.begin();
    expect(r.audio.setAmbient).toHaveBeenLastCalledWith(true);
    expect(r.log.indexOf('unlock')).toBeLessThan(r.log.indexOf('message:msg-a1'));
  });
  it('visibility loss pauses sound and simulation; only explicit resume unpauses them', () => {
    const r = setup(); r.begin(); r.app.visibility('hidden');
    expect(r.app.state).toBe('paused'); expect(r.audio.setPaused).toHaveBeenLastCalledWith(true);
    r.app.visibility('visible'); expect(r.app.state).toBe('paused');
    vi.mocked(r.audio.unlock).mockClear(); r.app.resume();
    expect(r.audio.unlock).toHaveBeenCalledOnce(); expect(r.audio.setPaused).toHaveBeenLastCalledWith(false);
    expect(r.app.state).toBe('running');
  });
  it('ends speech and warning state at debrief and before redo start cues', () => {
    const r = setup(); r.begin(); r.end(); expect(r.audio.endRun).toHaveBeenCalled();
    r.log.length = 0; r.app.redo('es-a');
    expect(r.app.state).toBe('redo');
    expect(r.log.indexOf('audio.reset')).toBeGreaterThanOrEqual(0);
    expect(r.log.indexOf('audio.reset')).toBeLessThan(r.log.indexOf('message:msg-a1'));
    expect(r.audio.setAmbient).toHaveBeenLastCalledWith(true);
  });
  it('restart stays silent in briefing and releases fresh cues only on Begin', () => {
    const r = setup(); r.begin(); r.end(); r.log.length = 0;
    r.app.restart(); expect(r.app.state).toBe('modeSelect'); r.app.chooseAuto(); expect(r.app.state).toBe('briefing');
    expect(r.log).toContain('audio.reset'); expect(r.log).not.toContain('message:msg-a1');
    expect(r.log).not.toContain('ambient:true');
    r.app.begin(); expect(r.log).toContain('message:msg-a1'); expect(r.audio.setAmbient).toHaveBeenLastCalledWith(true);
  });
  it('blocks alert acknowledgement before display mutation while paused or in resume grace', () => {
    const r = setup(); r.begin();
    r.bus.emitCue({ t: 0, seq: 0, body: { kind: 'alert', id: 'warning', level: 'warning', text: 'Original warning' } });
    const ack = () => { const id = r.alerts.ackHighest(); if (id) r.bus.emitAction({ kind: 'alertAck', alertId: id }); return id; };
    r.app.pause(); expect(ack()).toBeUndefined(); expect(r.alerts.list[0].acked).toBe(false);
    r.app.resume(); expect(ack()).toBeUndefined(); r.tick();
    expect(ack()).toBe('warning'); expect(r.alerts.list[0].acked).toBe(true);
    expect(r.audio.setWarning).toHaveBeenLastCalledWith(false);
  });
  it('drops the ending line when the debrief is hidden and never replays it on return', () => {
    const r = setup(); r.begin(); r.end(); vi.mocked(r.audio.reset).mockClear();
    r.app.visibility('hidden'); expect(r.audio.reset).toHaveBeenCalledOnce();
    vi.mocked(r.audio.setAmbient).mockClear(); r.app.visibility('visible');
    expect(r.app.state).toBe('debrief'); expect(r.audio.setAmbient).not.toHaveBeenCalled();
  });
  it('finish clears remaining audio and does not change grading', () => {
    const r = setup(); r.begin(); r.end(); const before = r.app.results(); vi.mocked(r.audio.endRun).mockClear();
    r.app.finish(); expect(r.app.state).toBe('finished'); expect(r.audio.endRun).toHaveBeenCalledOnce();
    expect(r.app.results()).toEqual(before);
  });
});

it('caption uses app time independent of audio, and pause/resume never resurrects it', () => {
 const r = setup(); r.begin();
 const emit = () => r.bus.emitCue({ t: 900000, seq: 50, body: { kind: 'message', channel: 'crew', id: 'crew', text: 'Crew line' } });
 emit(); expect(r.app.crewCaption.current(101)).toBe('Crew line');
 r.app.pause(); expect(r.app.crewCaption.current(101)).toBeNull(); r.app.resume(); expect(r.app.crewCaption.current(101)).toBeNull();
 // A cue arriving while paused still has a caption even though audio drops it.
 r.app.pause(); r.setNow(200); emit(); expect(r.app.crewCaption.current(201)).toBe('Crew line');
 r.app.resume(); r.tick(); r.end(); expect(r.app.crewCaption.current(201)).toBeNull();
 r.app.redo('es-a'); expect(r.app.crewCaption.current(201)).toBeNull();
});
it('debrief, finish and restart clear caption state', () => {
 const r = setup(); r.begin(); r.end();
 const emit = () => r.bus.emitCue({ t: 0, seq: 99, body: { kind: 'message', channel: 'crew', id: 'crew', text: 'Crew line' } });
 emit(); r.app.finish(); expect(r.app.crewCaption.current(101)).toBeNull();
 emit(); r.app.restart(); expect(r.app.crewCaption.current(101)).toBeNull();
});
