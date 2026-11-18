import type { EventBus } from '../bus/eventBus';
import type { TrainerAudio } from './audio';
import { ackAlert, alertsReducer, type ActiveAlert } from './displays/alerts';

/** Attach to the existing bus once; never dispatches pilot actions or changes grading. */
export function bindTrainerAudio(bus: EventBus, audio: TrainerAudio, onClick?: (listener: () => void) => () => void, canAcknowledge: () => boolean = () => true) {
  // Reuse display semantics: duplicate re-sends preserve ACK; changed entries become fresh alerts.
  let alerts: ActiveAlert[] = [];
  const syncWarning = () => audio.setWarning(alerts.some(alert => alert.level === 'warning' && !alert.acked));
  const offCue = bus.onCue(({ body: cue }) => {
    if (cue.kind === 'message') {
      audio.playMessage(cue);
      if (!cue.audio && cue.channel !== 'crew') audio.playSfx(cue.channel === 'cabin' ? 'chime' : 'radioIn');
    }
    if (cue.kind === 'alert' || cue.kind === 'alertClear') {
      const next = alertsReducer(alerts, cue);
      const changed = next !== alerts;
      alerts = next;
      syncWarning();
      if (changed && cue.kind === 'alert' && cue.level !== 'warning') audio.playSfx(cue.level === 'caution' ? 'alert' : 'chime');
    }
  });
  const offAction = bus.onAction(action => {
    if (action.kind === 'alertAck' && canAcknowledge()) { alerts = ackAlert(alerts, action.alertId); syncWarning(); }
  });
  const offClick = onClick?.(() => { void audio.unlock().then(() => audio.playSfx('click')); });
  return {
    reset() { alerts = []; audio.reset(); },
    endRun() { alerts = []; audio.setWarning(false); audio.endRun(); },
    dispose() { offCue(); offAction(); offClick?.(); alerts = []; audio.dispose(); },
  };
}
