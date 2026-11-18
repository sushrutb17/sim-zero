// FROZEN CONTRACT (Task 2). The single in-headset channel between cockpit, engine and remote bridge.
// Cockpit: emitAction(), onCue().  Engine / remote: onAction(), emitCue().
import type { PilotAction, Stamped, WorldCue } from '../contracts/events';

type Listener<T> = (value: T) => void;

export class EventBus {
  private readonly cueListeners = new Set<Listener<Stamped<WorldCue>>>();
  private readonly actionListeners = new Set<Listener<PilotAction>>();

  onCue(cb: Listener<Stamped<WorldCue>>): () => void {
    this.cueListeners.add(cb);
    return () => this.cueListeners.delete(cb);
  }

  emitCue(cue: Stamped<WorldCue>): void {
    for (const cb of [...this.cueListeners]) cb(cue);
  }

  onAction(cb: Listener<PilotAction>): () => void {
    this.actionListeners.add(cb);
    return () => this.actionListeners.delete(cb);
  }

  emitAction(action: PilotAction): void {
    for (const cb of [...this.actionListeners]) cb(action);
  }
}
