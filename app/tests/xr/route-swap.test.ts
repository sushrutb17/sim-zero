// T41: the route panel takes another flight's airports. The guide frames a cell by its pad's name, `pad:route.<airportId>`
// (src/xr/guide/resolve.ts), so every listed airport must have a pad of exactly that name, whichever flight is active.
import { describe, expect, it, vi } from 'vitest';
import { padNamesFor } from '../../src/xr/guide/resolve';

describe('route panel airports (T41)', () => {
  async function mk(first: Array<{ id: string; name: string }>) {
    vi.resetModules();
    const { Object3D } = await import('@iwsdk/core');
    vi.doMock('../../src/xr/panels/draw', () => ({
      ZoneCanvas: class {
        panel = { mesh: new Object3D(), markDirty: vi.fn(), tick: vi.fn(), setDraw: vi.fn() };
        W = 1;
        H = 1;
        text = vi.fn();
        measurer() { return (t: string) => t.length / 1000; }
        measure(t: string) { return t.length / 1000; }
        clear() {} box() {} fill() {} rect() {} line() {} lines() {}
      },
      lineHeightM: () => 0.01,
    }));
    const pads = new Map<string, { shown: boolean; press: () => void }>();
    vi.doMock('../../src/xr/panels/panelPad', () => ({
      createPanelPad: (_w: unknown, _z: unknown, id: string, onPress: () => void) => {
        const p = { shown: false, press: onPress };
        pads.set(id, p);
        return { rect() { p.shown = true; }, hide() { p.shown = false; }, press: () => 0, hover: () => 0, front: () => (p.shown ? { x: 1, y: 2, z: 3 } : undefined) };
      },
    }));
    const { createRoute } = await import('../../src/xr/panels/route');
    const actions: unknown[] = [];
    const view = createRoute({} as never, { emitAction: (a: unknown) => actions.push(a) } as never, { object3D: new Object3D() } as never, 0.0008, first, first[0].id);
    const shown = () => [...pads].filter(([, p]) => p.shown).map(([id]) => id).sort();
    return { view, pads, shown, actions };
  }
  const A = [{ id: 'dep', name: 'Alpha' }, { id: 'dest', name: 'Bravo' }, { id: 'alt1', name: 'Charlie' }];
  const B = [{ id: 'dep', name: 'Delta' }, { id: 'xyz', name: 'Echo' }];
  const done = () => { vi.doUnmock('../../src/xr/panels/draw'); vi.doUnmock('../../src/xr/panels/panelPad'); };

  it('every listed airport has a pad named route.<id> (what the guide frames), before and after a swap', async () => {
    const { view, pads, shown } = await mk(A);
    expect(shown()).toEqual(['route.alt1', 'route.dep', 'route.dest']);
    expect(Object.keys(view.targets()).sort()).toEqual(['route:alt1', 'route:dep', 'route:dest']);
    view.setAirports(B, 'xyz');
    expect(shown()).toEqual(['route.dep', 'route.xyz']); // alt1 and dest are hidden, not deleted
    expect(pads.has('route.alt1')).toBe(true);
    expect(Object.keys(view.targets()).sort()).toEqual(['route:dep', 'route:xyz']);
    expect(view.targets()['route:dest']).toBeUndefined();
    expect(view.model.rows().map((r) => r.id)).toEqual(['dep', 'xyz']);
    expect(view.model.selected()).toBe('xyz');
    // the guide's name for a cell is the pad that exists for it
    const names = (id: string) => padNamesFor({ kind: 'control', controlId: 'route.destination', value: id }, {} as never, {} as never);
    for (const id of ['dep', 'xyz']) expect(pads.has(names(id)[0].replace(/^pad:/, ''))).toBe(true);
    view.setAirports(A, 'dest'); // back: the old pads come back, none is made twice
    expect(shown()).toEqual(['route.alt1', 'route.dep', 'route.dest']);
    expect([...pads.keys()].sort()).toEqual(['route.alt1', 'route.dep', 'route.dest', 'route.xyz']);
    done();
  });

  it('pressing a cell selects that airport; a hidden pad of an old flight does nothing', async () => {
    const { view, pads, actions } = await mk(A);
    pads.get('route.dest')!.press();
    expect(actions).toEqual([{ kind: 'control', controlId: 'route.destination', value: 'dest' }]);
    view.setAirports(B, 'dep');
    pads.get('route.alt1')!.press(); // pressed through a stale reference: the model no longer lists alt1
    expect(actions).toHaveLength(1);
    pads.get('route.xyz')!.press();
    expect(actions[1]).toEqual({ kind: 'control', controlId: 'route.destination', value: 'xyz' });
    done();
  });
});
