import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowState } from '../../src/app/flow';
import type { GuideView } from '../../src/app/guide';
import { GuideSystem, setGuideDeps } from '../../src/xr/guide/guideSystem';

// Exercise the real driver's timing and resolver without constructing an XR world.
vi.mock('@iwsdk/core', () => ({ createSystem: () => class {} }));

type Deps = Parameters<typeof setGuideDeps>[0];

afterEach(() => vi.restoreAllMocks());

describe('guide system visibility', () => {
  for (const hidden of ['paused', 'debrief', 'unguided'] as const)
    it(`clears immediately when ${hidden}, then refreshes immediately on resume`, () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const view: GuideView = {
        stepId: 'landing', index: 1, count: 1, where: 'OVERHEAD', text: 'Switch the LAND light on.', waiting: false,
        targets: [{ kind: 'control', controlId: 'lights.landing', value: true }],
      };
      const app = {
        guided: true, state: 'running' as FlowState, guide: vi.fn(() => view), session: { engine: { state: {} } },
      };
      const frames = { show: vi.fn(), tick: vi.fn(), framedNames: () => [], framedPad: () => undefined };
      const screens = { setCoach: vi.fn() };
      setGuideDeps({ app: app as unknown as Deps['app'], frames, screens: screens as unknown as Deps['screens'], panels: {} as Deps['panels'] });
      const system = Object.create(GuideSystem.prototype) as GuideSystem;

      system.update();
      expect(frames.show).toHaveBeenLastCalledWith(['pad:lights.landing']);
      expect(screens.setCoach).toHaveBeenLastCalledWith({ head: 'STEP 1 OF 1 . OVERHEAD', body: view.text });

      now = 50; // Well inside the 200 ms guide refresh interval.
      if (hidden === 'unguided') app.guided = false;
      else app.state = hidden;
      system.update();
      expect(frames.show).toHaveBeenLastCalledWith([]);
      expect(screens.setCoach).toHaveBeenLastCalledWith(null);
      expect(frames.tick).toHaveBeenCalledTimes(1);
      expect(app.guide).toHaveBeenCalledTimes(1);

      now = 60; // Resuming must not wait for the old deadline at 200 ms.
      app.guided = true;
      app.state = 'running';
      system.update();
      expect(frames.show).toHaveBeenLastCalledWith(['pad:lights.landing']);
      expect(screens.setCoach).toHaveBeenLastCalledWith({ head: 'STEP 1 OF 1 . OVERHEAD', body: view.text });
      expect(app.guide).toHaveBeenCalledTimes(2);
    });
});
