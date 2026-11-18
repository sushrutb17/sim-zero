/**
 * App flow (Task 11, spec section 4.1): one pure reducer over the screens a judge moves through.
 * welcome -> flightSelect -> modeSelect -> practice -> briefing -> running (Event Sets 1-4) -> debrief -> redo / restart / finish.
 * `paused` can interrupt running or redo; the controller remembers which one to resume into (the event carries it), or abandons the run (T51).
 * No IWSDK imports: the reducer and its callers are tested headless.
 */

export type FlowState = 'welcome' | 'flightSelect' | 'modeSelect' | 'practice' | 'briefing' | 'running' | 'paused' | 'debrief' | 'redo' | 'finished';

export type FlowEvent =
  /** `skipFlightSelect`: only one flight is registered, so there is nothing to choose (today's route straight to the mode screen). */
  | { type: 'continue'; skipFlightSelect?: boolean }
  /** A flight was chosen on the picker. */
  | { type: 'chooseFlight' }
  | { type: 'chooseAuto'; skipPractice?: boolean }
  /** Guided flight: same route through the screens; the trainer also shows the next step. */
  | { type: 'chooseGuided'; skipPractice?: boolean }
  /** Manual ("Join instructor") was cut for this competition (2026-11-09): the reducer ignores it and the mode screen stays put. */
  | { type: 'chooseManual' }
  | { type: 'practiceDone' }
  | { type: 'begin' }
  | { type: 'pause' }
  | { type: 'resume'; to: 'running' | 'redo' }
  | { type: 'ended' }
  | { type: 'redo'; eventSetId: string }
  | { type: 'restart'; skipFlightSelect?: boolean }
  /** RESTART on the Paused screen (T51): the run is abandoned (no debrief) and the flow goes back to choosing a flight. */
  | { type: 'abandon'; skipFlightSelect?: boolean }
  | { type: 'finish' };

/** States in which pilot actions reach the engine and scenario time runs. */
export function isLive(s: FlowState): s is 'running' | 'redo' {
  return s === 'running' || s === 'redo';
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'continue':
      return state === 'welcome' ? (event.skipFlightSelect ? 'modeSelect' : 'flightSelect') : state;
    case 'chooseFlight':
      return state === 'flightSelect' ? 'modeSelect' : state;
    case 'chooseAuto':
    case 'chooseGuided':
      return state === 'modeSelect' ? (event.skipPractice ? 'briefing' : 'practice') : state;
    case 'chooseManual':
      return state;
    case 'practiceDone':
      return state === 'practice' ? 'briefing' : state;
    case 'begin':
      return state === 'briefing' ? 'running' : state;
    case 'pause':
      return isLive(state) ? 'paused' : state;
    case 'resume':
      return state === 'paused' ? event.to : state;
    case 'ended':
      return isLive(state) || state === 'paused' ? 'debrief' : state;
    case 'redo':
      return state === 'debrief' ? 'redo' : state;
    case 'restart':
      return state === 'debrief' || state === 'finished' ? (event.skipFlightSelect ? 'modeSelect' : 'flightSelect') : state;
    case 'abandon':
      return state === 'paused' ? (event.skipFlightSelect ? 'modeSelect' : 'flightSelect') : state;
    case 'finish':
      return state === 'debrief' ? 'finished' : state;
  }
}
