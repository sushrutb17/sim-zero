/**
 * Per-frame driver for the app flow (Task 11): ticks the TrainerApp (engine + state push) and the trainer screens.
 * Registered in index.ts; `delta` is the frame time in seconds (clamped to 0.1 s inside TrainerApp.frame).
 */
import { createSystem } from '@iwsdk/core';
import type { TrainerApp } from './controller';
import type { ScreensHost } from './screens/host';
import { removeLoadingScreen } from './loadingScreen';

let app: TrainerApp | undefined;
let screens: ScreensHost | undefined;
let extra: ((nowMs: number) => void) | undefined;

export function setAppForSystem(a: TrainerApp, s: ScreensHost, perFrame?: (nowMs: number) => void): void {
  app = a;
  screens = s;
  extra = perFrame;
}

export class AppFlowSystem extends createSystem({}) {
  update(delta: number): void {
    if (!app) return;
    app.frame(delta);
    const now = performance.now();
    screens?.setCrewCaption(app.crewCaption.current(now));
    screens?.tick(now);
    if (screens?.welcomeDrawnAt() !== undefined) removeLoadingScreen(); // the welcome screen is up: drop the HTML loading screen
    extra?.(now);
  }
}
