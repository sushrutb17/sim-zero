// T49: the page Start button, the page and pinch gesture hooks, the sound-off state and the welcome screen's line.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_UNLOCK_EVENTS, SESSION_UNLOCK_EVENTS, installPageGestureUnlock, installSessionGestureUnlock } from '../../src/app/audioUnlock';
import { isSoundOff, setSoundOff } from '../../src/app/soundState';
import { START_LABEL, START_SUBLINE, installStartButton } from '../../src/app/startButton';
import { SOUND_OFF_LINE, WELCOME_TITLE, welcomeScreen } from '../../src/app/screens/welcome';
import { singleSource } from '../../src/scenarios/single-source';
import type { ZoneCanvas } from '../../src/xr/panels/draw';

class FakeTarget {
  handlers = new Map<string, Array<() => void>>();
  options = new Map<string, unknown>();
  addEventListener(type: string, fn: () => void, options?: unknown) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    this.options.set(type, options);
  }
  fire(type: string) { for (const fn of this.handlers.get(type) ?? []) fn(); }
}

describe('gesture hooks (T49)', () => {
  it('every page tap, click and key calls unlock synchronously, in the capture phase', () => {
    const doc = new FakeTarget();
    const unlock = vi.fn();
    installPageGestureUnlock(unlock, doc);
    expect([...doc.handlers.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'touchend']);
    expect(PAGE_UNLOCK_EVENTS).toHaveLength(4);
    for (const type of PAGE_UNLOCK_EVENTS) {
      unlock.mockClear();
      doc.fire(type); // no await: the call must happen inside the dispatch
      expect(unlock, type).toHaveBeenCalledOnce();
      expect(doc.options.get(type)).toEqual({ capture: true });
    }
  });

  it('a pinch (select start, select) or squeeze in the session calls unlock synchronously; no session is a no-op', () => {
    const session = new FakeTarget();
    const unlock = vi.fn();
    installSessionGestureUnlock(session, unlock);
    expect([...session.handlers.keys()].sort()).toEqual(['select', 'selectstart', 'squeezestart']);
    for (const type of SESSION_UNLOCK_EVENTS) { unlock.mockClear(); session.fire(type); expect(unlock, type).toHaveBeenCalledOnce(); }
    expect(() => installSessionGestureUnlock(null, unlock)).not.toThrow();
    expect(() => installSessionGestureUnlock(undefined, unlock)).not.toThrow();
  });
});

describe('sound state (T49)', () => {
  afterEach(() => { setSoundOff(false); });
  it('reports a change once, and starts as on', () => {
    expect(isSoundOff()).toBe(false);
    expect(setSoundOff(true)).toBe(true);
    expect(setSoundOff(true)).toBe(false);
    expect(isSoundOff()).toBe(true);
    expect(setSoundOff(false)).toBe(true);
  });
});

describe('welcome screen (T49)', () => {
  afterEach(() => { setSoundOff(false); });
  const draw = () => {
    const texts: string[] = [];
    const colours = new Map<string, string>();
    const zc = {
      W: 0.48, H: 0.22,
      clear() {}, box() {},
      measurer: () => (t: string) => t.length * 0.0035,
      text(t: string, _x: number, _y: number, _role: string, colour: string) { texts.push(t); colours.set(t, colour); },
    } as unknown as ZoneCanvas;
    welcomeScreen.draw(zc, { scenario: singleSource, flights: [], flight: undefined as never, level: () => 'idle', seatOffset: () => 0.1 });
    return { texts, colours };
  };
  it('greets with "Welcome to Sim Zero", and shows the sound-off line only while sound is off', () => {
    expect(WELCOME_TITLE).toBe('Welcome to Sim Zero');
    const on = draw();
    expect(on.texts).toContain('Welcome to Sim Zero');
    expect(on.texts.join(' ')).not.toContain('Sound is off');
    setSoundOff(true);
    const off = draw();
    expect(off.texts.join(' ')).toContain('Sound is off.');
    expect(off.texts.join(' ')).toContain('turn it on');
    setSoundOff(false);
    expect(draw().texts.join(' ')).not.toContain('Sound is off');
  });
  it('shows the build stamp without a commit id', () => {
    const stamp = draw().texts.find((t) => t.startsWith('Build'));
    expect(stamp).toBe('Build unknown'); // node has no build define; with one it would read "Build Nov 15, 4:42 PM"
  });
});

interface FakeEl {
  tag: string; id: string; className: string; type: string; textContent: string;
  style: { cssText: string; display: string }; children: FakeEl[]; listeners: Record<string, Array<() => void>>;
  append(...c: FakeEl[]): void; addEventListener(t: string, f: () => void): void;
}
const el = (tag: string): FakeEl => ({
  tag, id: '', className: '', type: '', textContent: '', style: { cssText: '', display: '' }, children: [], listeners: {},
  append(...c) { this.children.push(...c); },
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
});
const textOf = (e: FakeEl): string => [e.textContent, ...e.children.map(textOf)].join('|');

describe('Start button (T49)', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(available?: boolean) {
    const head = el('head'); const body = el('body');
    vi.stubGlobal('document', { createElement: (t: string) => el(t), head, body });
    const onStart = vi.fn();
    const button = installStartButton({ onStart, available });
    const screen = body.children[0];
    return { button, screen, onStart, click: () => { const b = screen.children.find((c) => c.tag === 'button')!; b.listeners.click.forEach((f) => f()); } };
  }
  it('reads "Start Sim Zero" with the sound sub-line, and is hidden until the app is ready', () => {
    const { button, screen } = setup();
    expect(START_LABEL).toBe('Start Sim Zero');
    expect(START_SUBLINE).toBe('Tap to start, with sound');
    expect(textOf(screen)).toContain('Start Sim Zero');
    expect(textOf(screen)).toContain('Tap to start, with sound');
    expect(screen.style.display).toBe('none');
    button.setReady();
    expect(screen.style.display).toBe('flex');
  });
  it('hides while an immersive session is presenting and shows again when it ends', () => {
    const { button, screen } = setup();
    button.setReady();
    button.setPresenting(true); expect(screen.style.display).toBe('none');
    button.setPresenting(false); expect(screen.style.display).toBe('flex');
  });
  it('a session that starts before the app is ready keeps it hidden after setReady', () => {
    const { button, screen } = setup();
    button.setPresenting(true); button.setReady(); expect(screen.style.display).toBe('none');
  });
  it('the click runs onStart synchronously, and a throwing onStart does not escape the handler', () => {
    const { button, onStart, click } = setup();
    button.setReady();
    click(); expect(onStart).toHaveBeenCalledOnce();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    onStart.mockImplementation(() => { throw new Error('no XR'); });
    expect(() => click()).not.toThrow();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('never shows without WebXR', () => {
    const { button, screen } = setup(false);
    button.setReady(); expect(screen.style.display).toBe('none');
  });
});
