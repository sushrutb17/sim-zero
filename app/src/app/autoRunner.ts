/**
 * Auto mode wiring (Task 11): the single event path between the cockpit and the engine.
 *   cockpit controls / panels --bus.emitAction--> engine.dispatch   (ONLY while isLive(), i.e. flow running or redo)
 *   session cues --> panels.handleCue + bus.emitCue (displays' alert list, later audio and the remote bridge)
 * Cues can be HELD (after a restart, until Begin) so the second run reaches the panels exactly like the first.
 */
import type { EventBus } from '../bus/eventBus';
import type { Stamped, WorldCue } from '../contracts/events';
import type { TrainingSession } from '../engine/session';

export interface CueSink {
  handleCue(cue: Stamped<WorldCue>): void;
}

export interface AutoRunner {
  /** Queue cues instead of forwarding them. */
  hold(): void;
  /** Forward queued cues (in order) and stop holding. */
  release(): void;
  dispose(): void;
}

export function startAuto(session: TrainingSession, bus: EventBus, opts: { panels: CueSink; isLive: () => boolean }): AutoRunner {
  let held = false;
  const queue: Stamped<WorldCue>[] = [];
  const forward = (cue: Stamped<WorldCue>) => {
    opts.panels.handleCue(cue);
    bus.emitCue(cue);
  };
  const offCue = session.onCue((cue) => {
    if (held) queue.push(cue);
    else forward(cue);
  });
  // session.engine is read per action: restart() replaces the engine.
  const offAction = bus.onAction((a) => {
    if (opts.isLive()) session.engine.dispatch(a);
  });
  return {
    hold() {
      held = true;
    },
    release() {
      held = false;
      const q = queue.splice(0);
      for (const c of q) forward(c);
    },
    dispose() {
      offCue();
      offAction();
    },
  };
}
