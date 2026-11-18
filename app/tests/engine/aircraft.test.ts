import { describe, expect, it } from 'vitest';
import type { AircraftState } from '../../src/contracts/aircraft';
import { ScenarioClock } from '../../src/engine/clock';
import { applyControl, applyPatch, readPath, stepAircraft } from '../../src/engine/aircraft';
import { miniScenario } from '../fixtures/mini-scenario';

const base = (): AircraftState => structuredClone(miniScenario.initialAircraft) as AircraftState;
const flying = (over: Partial<AircraftState> = {}): AircraftState => ({ ...base(), phase: 'climb', ...over });

describe('ScenarioClock', () => {
  it('clock advance returns 0 while paused', () => {
    const c = new ScenarioClock();
    expect(c.now).toBe(0);
    expect(c.advance(2)).toBe(2);
    expect(c.now).toBe(2);
    c.pause();
    expect(c.advance(5)).toBe(0);
    expect(c.now).toBe(2);
    c.resume();
    expect(c.advance(1)).toBe(1);
    expect(c.now).toBe(3);
  });
  it('ignores dt <= 0', () => {
    const c = new ScenarioClock();
    expect(c.advance(0)).toBe(0);
    expect(c.advance(-1)).toBe(0);
    expect(c.now).toBe(0);
  });
});

describe('stepAircraft', () => {
  it('heading turns shortest way 350→010 through 360', () => {
    const s = flying({ headingDeg: 350, ap: { ...base().ap, engaged: true, hdg: 10 } });
    expect(stepAircraft(s, 10).headingDeg).toBeCloseTo(10, 6);
  });
  it('turns left when shorter and never overshoots', () => {
    const s = flying({ headingDeg: 10, ap: { ...base().ap, engaged: true, hdg: 350 } });
    expect(stepAircraft(s, 3).headingDeg).toBeCloseTo(1, 6);
    expect(stepAircraft(s, 100).headingDeg).toBeCloseTo(350, 6);
  });
  it('does not turn when ap not engaged', () => {
    const s = flying({ headingDeg: 90, ap: { ...base().ap, engaged: false, hdg: 180 } });
    expect(stepAircraft(s, 10).headingDeg).toBe(90);
  });
  it('climb 2500 fpm', () => {
    const s = flying({ altitudeFt: 1000, ap: { ...base().ap, engaged: true, vertical: 'climb', alt: 11000 } });
    expect(stepAircraft(s, 60).altitudeFt).toBeCloseTo(3500, 0);
  });
  it('does not climb when ap not engaged', () => {
    const s = flying({ altitudeFt: 1000, ap: { ...base().ap, engaged: false, vertical: 'climb', alt: 11000 } });
    expect(stepAircraft(s, 60).altitudeFt).toBe(1000);
  });
  it('does not overshoot target altitude', () => {
    const s = flying({ altitudeFt: 4900, ap: { ...base().ap, engaged: true, vertical: 'climb', alt: 5000 } });
    expect(stepAircraft(s, 60).altitudeFt).toBe(5000);
    const d = flying({ altitudeFt: 5100, ap: { ...base().ap, engaged: true, vertical: 'climb', alt: 5000 } });
    expect(stepAircraft(d, 60).altitudeFt).toBe(5000);
  });
  it('hold leaves altitude unchanged', () => {
    const s = flying({ altitudeFt: 3000, ap: { ...base().ap, vertical: 'hold', alt: 9000 } });
    expect(stepAircraft(s, 60).altitudeFt).toBe(3000);
  });
  it('nothing moves while holding', () => {
    const s = { ...base(), ap: { ...base().ap, engaged: true, hdg: 200, vertical: 'climb' as const, alt: 9000 } };
    const r = stepAircraft(s, 30);
    expect(r).toEqual(s);
  });
  it('normalizes heading to [0,360)', () => {
    const s = flying({ headingDeg: 365 });
    expect(stepAircraft(s, 1).headingDeg).toBe(5);
  });
  it('phase takeoff→climb above 50 ft, →cruise near ap.alt above 10000', () => {
    const t = { ...base(), phase: 'takeoff' as const, altitudeFt: 100 };
    expect(stepAircraft(t, 0).phase).toBe('climb');
    const c = flying({ altitudeFt: 10950, ap: { ...base().ap, vertical: 'hold', alt: 11000 } });
    expect(stepAircraft(c, 1).phase).toBe('cruise');
    const low = flying({ altitudeFt: 4950, ap: { ...base().ap, vertical: 'hold', alt: 5000 } });
    expect(stepAircraft(low, 1).phase).toBe('climb');
  });
  it('does not mutate input', () => {
    const s = flying({ altitudeFt: 1000, ap: { ...base().ap, engaged: true, hdg: 200, vertical: 'climb', alt: 5000 } });
    const copy = structuredClone(s);
    stepAircraft(s, 10);
    expect(s).toEqual(copy);
  });
});

describe('applyControl', () => {
  it('elec.gen1=false sets switchOn false, keeps failed', () => {
    const s = base();
    s.elec.gen1.failed = true;
    const r = applyControl(s, { kind: 'control', controlId: 'elec.gen1', value: false });
    expect(r.elec.gen1).toEqual({ switchOn: false, failed: true });
    expect(r.elec.gen2).toEqual(s.elec.gen2);
  });
  it('ap.engage, lights.landing, route.destination', () => {
    let r = applyControl(base(), { kind: 'control', controlId: 'ap.engage', value: true });
    expect(r.ap.engaged).toBe(true);
    r = applyControl(r, { kind: 'control', controlId: 'lights.landing', value: true });
    expect(r.lights.landing).toBe(true);
    r = applyControl(r, { kind: 'control', controlId: 'route.destination', value: 'dep' });
    expect(r.destination).toBe('dep');
  });
  it('maps remaining controls and normalizes ap.hdg', () => {
    let r = applyControl(base(), { kind: 'control', controlId: 'ap.hdg', value: 360 });
    expect(r.ap.hdg).toBe(0);
    r = applyControl(r, { kind: 'control', controlId: 'ap.alt', value: 8000 });
    r = applyControl(r, { kind: 'control', controlId: 'ap.lateral', value: 'nav' });
    r = applyControl(r, { kind: 'control', controlId: 'ap.vertical', value: 'climb' });
    r = applyControl(r, { kind: 'control', controlId: 'baro.set', value: 1020 });
    r = applyControl(r, { kind: 'control', controlId: 'lights.strobe', value: true });
    r = applyControl(r, { kind: 'control', controlId: 'elec.gen2', value: false });
    r = applyControl(r, { kind: 'control', controlId: 'elec.busTie', value: false });
    r = applyControl(r, { kind: 'control', controlId: 'radio.com1', value: 'app' });
    expect(r.ap).toMatchObject({ alt: 8000, lateral: 'nav', vertical: 'climb' });
    expect(r.baroHpa).toBe(1020);
    expect(r.lights.strobe).toBe(true);
    expect(r.elec.gen2.switchOn).toBe(false);
    expect(r.elec.busTie).toBe(false);
    expect(r.comFreq).toBe('app');
  });
  it('pa.cabin and practice.toggle leave state equal (new object)', () => {
    const s = base();
    const a = applyControl(s, { kind: 'control', controlId: 'pa.cabin', value: true });
    const b = applyControl(s, { kind: 'control', controlId: 'practice.toggle', value: true });
    expect(a).toEqual(s);
    expect(a).not.toBe(s);
    expect(b).toEqual(s);
  });
  it('does not mutate input', () => {
    const s = base();
    const copy = structuredClone(s);
    applyControl(s, { kind: 'control', controlId: 'elec.gen1', value: false });
    expect(s).toEqual(copy);
  });
});

describe('readPath', () => {
  it('readPath elec.gen1.failed', () => {
    const s = base();
    expect(readPath(s, 'elec.gen1.failed')).toBe(false);
    s.elec.gen1.failed = true;
    expect(readPath(s, 'elec.gen1.failed')).toBe(true);
    expect(readPath(s, 'altitudeFt')).toBe(0);
    expect(readPath(s, 'nope.x')).toBeUndefined();
  });
});

describe('applyPatch', () => {
  it('deep-merges {elec:{gen1:{failed:true}}} keeping gen1.switchOn and gen2', () => {
    const s = base();
    const copy = structuredClone(s);
    const r = applyPatch(s, { elec: { gen1: { failed: true } } });
    expect(r.elec.gen1).toEqual({ switchOn: true, failed: true });
    expect(r.elec.gen2).toEqual(s.elec.gen2);
    expect(r.elec.busTie).toBe(true);
    expect(s).toEqual(copy);
  });
  it('null is a value, primitives replace', () => {
    const s = { ...base(), stormBearingDeg: 45 };
    expect(applyPatch(s, { stormBearingDeg: null }).stormBearingDeg).toBeNull();
    expect(applyPatch(s, { phase: 'takeoff', altitudeFt: 5 })).toMatchObject({ phase: 'takeoff', altitudeFt: 5 });
  });
});
