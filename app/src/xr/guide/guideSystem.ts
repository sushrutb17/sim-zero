/**
 * Per-frame driver for guided flight: ticks the frame pool every frame and, at most every 200 ms, turns the current guide
 * step into pad frames and the windscreen coach strip. Without guidance (unguided flight, or the flow not live) it shows nothing.
 */
import { createSystem } from '@iwsdk/core';
import { isLive } from '../../app/flow';
import { GUIDE_IDLE_TEXT } from '../../app/guide';
import type { TrainerApp } from '../../app/controller';
import type { ScreensHost } from '../../app/screens/host';
import type { GuideFrames } from './frames';
import { padNamesForAll, type GuidePanels } from './resolve';

const REFRESH_MS = 200;
const NO_PADS: readonly string[] = [];

interface Deps {
  app: TrainerApp;
  frames: GuideFrames;
  screens: ScreensHost;
  panels: GuidePanels;
}
let deps: Deps | undefined;
let lastAt = -Infinity;

export function setGuideDeps(d: Deps): void {
  deps = d;
  lastAt = -Infinity;
}

export class GuideSystem extends createSystem({}) {
  update(): void {
    if (!deps) return;
    const { app, frames, screens, panels } = deps;
    const now = performance.now();
    if (!app.guided || !isLive(app.state)) {
      frames.show(NO_PADS);
      screens.setCoach(null);
      lastAt = -Infinity;
      return;
    }
    frames.tick(now);
    if (now - lastAt < REFRESH_MS) return;
    lastAt = now;
    const view = app.guide();
    if (!view) {
      frames.show(NO_PADS);
      screens.setCoach({ head: 'GUIDED FLIGHT', body: GUIDE_IDLE_TEXT });
      return;
    }
    frames.show(padNamesForAll(view.targets, app.session.engine.state, panels));
    screens.setCoach({ head: `STEP ${view.index} OF ${view.count} . ${view.where}`, body: view.text });
  }
}
