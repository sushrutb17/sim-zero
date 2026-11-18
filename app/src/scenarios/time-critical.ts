// Original, fictional content for the generic cockpit. No airline documents or real procedures.
// Every checklist, communication sequence, timing and decision criterion below is invented:
// to be validated by the user (a pilot). This is scenario-management practice, not medical advice.
import { parseScenario, type CueRule, type Scenario } from '../contracts/scenario';
import { VOICED_MESSAGE_IDS } from './single-source.voice';
import { withVoice } from './voice';
import { st, all, any, at, fired, replied, control, allTicked, between } from './dsl';

const CALLSIGN = 'Velrune 638';
const LARGE = 'Selwick Reach';
const NEAR = 'Brindle Fen';
const DEST = 'Tarnelow Bay';
const FREQ = '128.35'; // Fictional facility assignment.
const CRUISE_ITEMS = [
  { id: 'tc-cr-autopilot', text: 'Autopilot - ENGAGED, heading mode, 26,000 ft HOLD' },
  { id: 'tc-cr-frequency', text: 'Center frequency - CONFIRMED' },
  { id: 'tc-cr-route', text: 'Route and enroute weather - REVIEWED' },
];
const DIVERSION_ITEMS = [
  { id: 'tc-dv-condition', text: 'Passenger report and airport options - REVIEWED' },
  { id: 'tc-dv-clearance', text: 'Medical diversion clearance, route and heading - CONFIRMED' },
  { id: 'tc-dv-dispatch', text: 'Dispatch - INFORMED of the selected airport and medical need' },
  { id: 'tc-dv-cabin', text: 'Cabin plan and next update - PREPARED' },
];
const CRUISE_DONE = allTicked('tc-cruise', CRUISE_ITEMS.map(i => i.id));
const DIVERSION_DONE = allTicked('tc-diversion', DIVERSION_ITEMS.map(i => i.id));
// Recovery cards are less specific but still request the fact needed to advance.
const ASKED_CONDITION = any(replied({ cardId: 'tc-ask-condition' }), replied({ messageId: 'tc-condition-clarify', cardId: 'tc-condition-summary' }));
const ASKED_ATTENDING = any(replied({ cardId: 'tc-ask-attending' }), replied({ messageId: 'tc-attending-clarify', cardId: 'tc-attending-summary' }));
const ASKED_DOCTOR = any(replied({ cardId: 'tc-ask-doctor' }), replied({ messageId: 'tc-doctor-clarify', cardId: 'tc-doctor-summary' }));
const DISPATCH_INFORMED = any(
  replied({ messageId: 'tc-dispatch-large', cardId: 'tc-dispatch-informed' }),
  replied({ messageId: 'tc-dispatch-near', cardId: 'tc-dispatch-informed' }),
  replied({ messageId: 'tc-dispatch-clarify-large' }),
  replied({ messageId: 'tc-dispatch-clarify-near' }),
);
const TRAFFIC_SET = all(st('ap.hdg', 'eq', 110), st('ap.engaged', 'eq', true), st('ap.lateral', 'eq', 'hdg'));
const CABIN_TALK = any(ASKED_CONDITION, replied({ cardId: 'tc-commit-early' }), ASKED_ATTENDING, ASKED_DOCTOR);
const DIVERT_REQUESTED = any(fired('tc-clear-large'), fired('tc-clear-near'));
const CONFIRMED_CONTINUE = replied({ cardId: 'tc-confirm-continue' });
const DECIDED = any(DIVERT_REQUESTED, CONFIRMED_CONTINUE);
const CABIN_BRIEFED = replied({ messageId: 'tc-cabin-brief' });
const LEVEL = all(st('ap.engaged', 'eq', true), st('ap.lateral', 'eq', 'hdg'), st('ap.vertical', 'eq', 'hold'), st('ap.alt', 'eq', 26000), between('altitudeFt', 25900, 26100));
const DIVERSION_SET_UP = all(
  LEVEL,
  any(
    all(fired('tc-clear-large'), st('destination', 'eq', 'tc-large'), st('ap.hdg', 'eq', 70), between('headingDeg', 68, 72)),
    all(fired('tc-clear-near'), st('destination', 'eq', 'tc-near'), st('ap.hdg', 'eq', 150), between('headingDeg', 148, 152)),
  ),
  CABIN_BRIEFED,
);
const CONTINUE_CONFIRMED = all(fired('tc-dispatch-concern'), CONFIRMED_CONTINUE, CABIN_BRIEFED);
const DIVERSION_CARDS = [
  { id: 'tc-divert-large', text: `Medical emergency. Request diversion to ${LARGE}, ${CALLSIGN}.` },
  { id: 'tc-divert-near', text: `Medical emergency. Request diversion to ${NEAR}, ${CALLSIGN}.` },
];
const DECISION_CARDS = [...DIVERSION_CARDS, { id: 'tc-continue', text: `Continue to ${DEST}, ${CALLSIGN}.` }];
const CONDITION_CARD = { id: 'tc-ask-condition', text: 'What is the passenger condition now? Are they responsive and breathing?' };
const ATTENDING_CARD = { id: 'tc-ask-attending', text: 'Who is attending the passenger, and what help have you found?' };
const DOCTOR_CARD = { id: 'tc-ask-doctor', text: 'Is a doctor on board who can assess the passenger?' };
const dispatchCard = (name: string) => ({ id: 'tc-dispatch-informed', text: `Confirmed: diverting to ${name} for urgent hospital care. Please arrange a medical team.` });
const dispatchFollowUp = (side: 'large' | 'near', name: string): CueRule => ({
  id: `tc-dispatch-recheck-${side}`,
  instructorLabel: 'Vague dispatch reply: ask again, with either reply advancing coordination',
  when: replied({ messageId: `tc-dispatch-${side}`, cardId: 'tc-dispatch-vague' }),
  cues: [{ kind: 'message', id: `tc-dispatch-clarify-${side}`, channel: 'dispatch', text: `Please be specific: are you diverting to ${name} for hospital care? We need the plan to coordinate the medical team.`, cards: [dispatchCard(name), { id: 'tc-dispatch-brief', text: 'Yes, the cleared diversion airport. Please arrange hospital care.' }] }],
});
const clearance = (side: 'large' | 'near', name: string, hdg: number): CueRule => ({
  id: `tc-clear-${side}`,
  instructorLabel: `Medical diversion requested to ${name}; ATC issues a heading, dispatch asks for confirmation`,
  when: replied({ cardId: `tc-divert-${side}` }),
  cues: [
    { kind: 'message', id: `tc-atc-clear-${side}`, channel: 'atc', text: `${CALLSIGN}, medical emergency acknowledged. Turn heading ${hdg === 70 ? '070' : '150'} for ${name}, maintain 26,000 feet. No descent clearance yet.` },
    { kind: 'message', id: `tc-dispatch-${side}`, channel: 'dispatch', text: `Please confirm ${name} is your diversion airport and a hospital transfer is required.`, cards: [dispatchCard(name), { id: 'tc-dispatch-vague', text: 'We are looking at options. We will be in touch.' }] },
  ],
});

export const timeCritical: Scenario = parseScenario(withVoice({
  id: 'time-critical',
  title: 'Time Critical',
  notice: 'Generic fictional aircraft for scenario-management practice only. These are invented, not real or approved procedures. No medical treatment is simulated. Voices are computer-generated.',
  timeCompression: 6,
  latenessGraceSec: 10,
  initialAircraft: {
    altitudeFt: 26000, headingDeg: 90, speedKt: 410, phase: 'cruise',
    ap: { engaged: true, hdg: 90, alt: 26000, lateral: 'hdg', vertical: 'hold' },
    baroHpa: 1013, lights: { landing: false, strobe: true },
    elec: { gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false }, backupGenInop: false, busTie: false },
    comFreq: '124.65', destination: 'tc-dest', stormBearingDeg: null,
  },
  briefing: [
    { id: 'tc-flight', title: 'Your flight', body: `${CALLSIGN}, enroute to ${DEST}, 1 hour 40 minutes ahead. You are in cruise at 26,000 ft, heading 090. You operate all controls; the first officer gives factual callouts only. All names and operating details are fictional.` },
    { id: 'tc-status', title: 'Aircraft and weather', body: 'Both main generators and the backup are serviceable. Autopilot engaged in heading mode and altitude hold. No system failure and no storm. Stay at 26,000 ft until a new clearance; this exercise does not include descent, approach or landing.' },
    { id: 'tc-how', title: 'How it works', body: 'Tap reply cards to speak. Read incoming printouts on the kneeboard. Complete checklist lines on the lower left. Use the route panel for the destination and the autopilot for heading. Hints are available on the kneeboard and noted in the debrief.' },
  ],
  airports: [{ id: 'tc-dest', name: DEST }, { id: 'tc-large', name: LARGE }, { id: 'tc-near', name: NEAR }],
  checklists: [{ id: 'tc-cruise', title: 'CRUISE', items: CRUISE_ITEMS }, { id: 'tc-diversion', title: 'DIVERSION', items: DIVERSION_ITEMS }],
  practice: { controlId: 'practice.toggle', prompt: 'Practice: poke the PRACTICE switch with your fingertip to turn it on.' },
  eventSets: [
    {
      id: 'tc-es1-cruise', title: 'Cruise', phase: 'Cruise at 26,000 ft', environment: 'Clear enroute weather; routine traffic',
      distracters: ['Dispatch weather update arrives while changing frequency'], trigger: 'Center frequency handoff',
      technical: 'Cruise automation and frequency management', crm: 'Monitoring',
      objective: 'Read back the new frequency, confirm level cruise and review the route weather with the short cruise checklist.',
      instructorNotes: 'Invented cruise procedure, to be validated by the user (a pilot). As in Single Source, answering the handoff tunes the radio automatically. No fault is injected. The set ends after the handoff and all cruise checklist items, or after 150 s.',
      startCues: [
        { kind: 'checklistAvailable', checklistId: 'tc-cruise' },
        { kind: 'message', id: 'tc-frequency', channel: 'atc', text: `${CALLSIGN}, contact the next Center sector on ${FREQ}.`, cards: [{ id: 'tc-frequency-readback', text: `${FREQ}, ${CALLSIGN}.` }, { id: 'tc-frequency-vague', text: 'Changing frequency.' }] },
        { kind: 'printout', id: 'tc-weather', title: 'Enroute weather update', body: `${LARGE}: clear, visibility over 10 km, wind 060 at 5 kt, runway dry. ${NEAR}: rain, visibility 5 km, runway wet, crosswind 24 kt; the fictional exercise crosswind limit is 25 kt. ${DEST}: clear, light wind.` },
      ],
      rules: [
        { id: 'tc-frequency-change', instructorLabel: 'Handoff answered; radio changes to the next sector', when: replied({ messageId: 'tc-frequency' }), cues: [{ kind: 'aircraft', patch: { comFreq: FREQ } }, { kind: 'message', id: 'tc-center-contact', channel: 'atc', text: `${CALLSIGN}, radar contact, maintain 26,000 feet.` }] },
        { id: 'tc-fo-cruise', instructorLabel: 'First officer confirms current level and mode', when: all(at(3), LEVEL), cues: [{ kind: 'message', id: 'tc-crew-cruise', channel: 'crew', text: 'Level at 26,000. Autopilot engaged, heading mode, altitude hold.' }] },
      ],
      endWhen: any(all(replied({ messageId: 'tc-frequency' }), CRUISE_DONE), at(150)),
      checks: [
        { kind: 'comm', id: 'tc-cr-frequency-quality', messageId: 'tc-frequency', quality: { 'tc-frequency-readback': 'good', 'tc-frequency-vague': 'poor' }, category: 'crm', reason: 'The new Center frequency was not read back clearly.' },
        { kind: 'required', id: 'tc-cr-level', when: LEVEL, category: 'automation', reason: 'The level cruise automation was not confirmed.' },
        { kind: 'required', id: 'tc-cr-radio', when: st('comFreq', 'eq', FREQ), category: 'procedures', reason: 'The Center frequency change was not completed.' },
        { kind: 'required', id: 'tc-cr-checklist', when: CRUISE_DONE, category: 'procedures', reason: 'The cruise checklist was not completed.' },
      ],
      hints: ['The latest Center call is on the comms panel.', 'The autopilot panel shows the active heading and altitude modes.', 'The cruise checklist is lower left; the weather update is on the kneeboard.'],
    },
    {
      id: 'tc-es2-cabin-call', title: 'Cabin call', phase: 'Cruise at 26,000 ft', environment: 'Traffic vector during a cabin interruption',
      distracters: ['ATC gives a traffic heading as the cabin calls'], trigger: 'A passenger has collapsed',
      technical: 'Heading automation', crm: 'Workload management and gathering facts',
      objective: 'Set the traffic heading, then establish passenger condition, who is attending and whether a doctor is on board before committing to a plan.',
      instructorNotes: 'Invented sequence, to be validated by the user (a pilot). The initial cabin response offers an explicit early commitment without naming an airport; choosing it opens another chance to ask about condition, so the minor trap is recoverable. Reply cards are mutually exclusive on that initial call. Talking to the cabin with the traffic heading unset is a separate minor error, corrected by setting heading 110 with AP engaged in heading mode. The set can end without that correction, preserving an uncorrected-minor grade. A vague question costs one grade point and opens a new clarification message; both clarification replies advance the fact-gathering chain. Ends after all three questions and the traffic readback, or after 150 s. Medical findings are fictional reports, not treatment instructions.',
      startCues: [
        { kind: 'message', id: 'tc-traffic', channel: 'atc', text: `${CALLSIGN}, turn heading 110 for traffic, maintain 26,000 feet.`, cards: [{ id: 'tc-traffic-readback', text: `Heading 110, maintain 26,000 feet, ${CALLSIGN}.` }, { id: 'tc-traffic-wrong', text: `Heading 010, maintain 26,000 feet, ${CALLSIGN}.` }, { id: 'tc-traffic-vague', text: 'Roger, we will turn.' }] },
        { kind: 'message', id: 'tc-cabin-collapse', channel: 'cabin', text: 'Captain, a passenger has collapsed. We are at their seat.', cards: [CONDITION_CARD, { id: 'tc-commit-early', text: 'We will divert to the nearest suitable airport. Stand by with the passenger details.' }] },
      ],
      rules: [
        { id: 'tc-early-commitment', instructorLabel: 'Early commitment before any condition report; cabin keeps the fact-gathering path open', when: replied({ cardId: 'tc-commit-early' }), cues: [{ kind: 'message', id: 'tc-cabin-recheck', channel: 'cabin', text: 'We have not given you the passenger condition yet. Do you want the current report?', cards: [CONDITION_CARD, { id: 'tc-condition-vague', text: 'Just tell me if everything is all right.' }] }] },
        { id: 'tc-condition-recheck', instructorLabel: 'Vague condition question: cabin asks for a specific request', when: replied({ cardId: 'tc-condition-vague' }), cues: [{ kind: 'message', id: 'tc-condition-clarify', channel: 'cabin', text: 'Please be specific about the passenger information you need.', cards: [CONDITION_CARD, { id: 'tc-condition-summary', text: 'Give me a brief report on their condition.' }] }] },
        { id: 'tc-attending-recheck', instructorLabel: 'Vague attendance question: cabin asks for a specific request', when: replied({ cardId: 'tc-attending-vague' }), cues: [{ kind: 'message', id: 'tc-attending-clarify', channel: 'cabin', text: 'Do you need to know who is helping the passenger? Please clarify.', cards: [ATTENDING_CARD, { id: 'tc-attending-summary', text: 'Tell me who is helping.' }] }] },
        { id: 'tc-doctor-recheck', instructorLabel: 'Vague doctor question: cabin asks for a specific request', when: replied({ cardId: 'tc-doctor-vague' }), cues: [{ kind: 'message', id: 'tc-doctor-clarify', channel: 'cabin', text: 'Please clarify whether you need a report about a doctor on board.', cards: [DOCTOR_CARD, { id: 'tc-doctor-summary', text: 'Tell me whether a doctor has come forward.' }] }] },
        { id: 'tc-condition-answer', instructorLabel: 'Condition requested: factual cabin report and a question about attendance', when: ASKED_CONDITION, cues: [{ kind: 'message', id: 'tc-condition-report', channel: 'cabin', text: 'The passenger is unresponsive but breathing. A cabin crew member is with them.', cards: [ATTENDING_CARD, { id: 'tc-attending-vague', text: 'Do the passengers nearby need reassurance?' }] }] },
        { id: 'tc-attending-answer', instructorLabel: 'Attendance requested: cabin crew are attending; ask about a doctor', when: ASKED_ATTENDING, cues: [{ kind: 'message', id: 'tc-attending-report', channel: 'cabin', text: 'Two cabin crew are attending. We have asked for medical volunteers.', cards: [DOCTOR_CARD, { id: 'tc-doctor-vague', text: 'Can you bring me an update later?' }] }] },
        { id: 'tc-doctor-located', instructorLabel: 'Doctor question asked; assessment follows in the decision set', when: ASKED_DOCTOR, cues: [{ kind: 'message', id: 'tc-doctor-found', channel: 'cabin', text: 'A doctor has come forward and is assessing the passenger. We will relay their assessment.' }] },
        { id: 'tc-fo-traffic', instructorLabel: 'First officer confirms the actual traffic heading', when: all(TRAFFIC_SET, between('headingDeg', 108, 112)), cues: [{ kind: 'message', id: 'tc-crew-traffic', channel: 'crew', text: 'Heading 110, level at 26,000.' }] },
      ],
      endWhen: any(all(at(15), replied({ messageId: 'tc-traffic' }), ASKED_CONDITION, ASKED_ATTENDING, ASKED_DOCTOR), at(150)),
      checks: [
        { kind: 'comm', id: 'tc-ca-traffic-quality', messageId: 'tc-traffic', quality: { 'tc-traffic-readback': 'good', 'tc-traffic-wrong': 'poor', 'tc-traffic-vague': 'poor' }, category: 'crm', reason: 'The traffic heading and level were not read back.' },
        { kind: 'comm', id: 'tc-ca-recheck-quality', messageId: 'tc-cabin-recheck', quality: { 'tc-ask-condition': 'good', 'tc-condition-vague': 'poor' }, category: 'crm', reason: 'The follow-up cabin reply did not clearly ask for passenger condition.' },
        { kind: 'comm', id: 'tc-ca-attending-quality', messageId: 'tc-condition-report', quality: { 'tc-ask-attending': 'good', 'tc-attending-vague': 'poor' }, category: 'crm', reason: 'The reply to the condition report did not establish who was attending.' },
        { kind: 'comm', id: 'tc-ca-doctor-quality', messageId: 'tc-attending-report', quality: { 'tc-ask-doctor': 'good', 'tc-doctor-vague': 'poor' }, category: 'crm', reason: 'The reply to the attendance report did not ask about a doctor.' },
        { kind: 'comm', id: 'tc-ca-condition-clarity', messageId: 'tc-condition-clarify', quality: { 'tc-ask-condition': 'good', 'tc-condition-summary': 'acceptable' }, category: 'crm', reason: 'The clarification was not answered.' },
        { kind: 'comm', id: 'tc-ca-attending-clarity', messageId: 'tc-attending-clarify', quality: { 'tc-ask-attending': 'good', 'tc-attending-summary': 'acceptable' }, category: 'crm', reason: 'The clarification was not answered.' },
        { kind: 'comm', id: 'tc-ca-doctor-clarity', messageId: 'tc-doctor-clarify', quality: { 'tc-ask-doctor': 'good', 'tc-doctor-summary': 'acceptable' }, category: 'crm', reason: 'The clarification was not answered.' },
        { kind: 'required', id: 'tc-ca-condition', when: ASKED_CONDITION, category: 'crm', reason: 'Passenger condition was not requested before the decision.' },
        { kind: 'required', id: 'tc-ca-attending', when: ASKED_ATTENDING, category: 'crm', reason: 'Who was attending the passenger was not established.' },
        { kind: 'required', id: 'tc-ca-doctor', when: ASKED_DOCTOR, category: 'crm', reason: 'The availability of a doctor on board was not checked.' },
        { kind: 'errorTrap', id: 'tc-ca-early', when: replied({ cardId: 'tc-commit-early' }), trappedWhen: ASKED_CONDITION, severity: 'minor', category: 'crm', reason: 'A diversion was committed to before asking about passenger condition.' },
        { kind: 'errorTrap', id: 'tc-ca-heading', when: all(CABIN_TALK, any(st('ap.hdg', 'neq', 110), st('ap.engaged', 'eq', false), st('ap.lateral', 'neq', 'hdg'))), trappedWhen: TRAFFIC_SET, severity: 'minor', category: 'automation', reason: 'The traffic heading was left unset while talking to the cabin.' },
      ],
      hints: ['Compare the ATC traffic heading with the autopilot heading before handling the cabin call.', 'The cabin reply cards let you ask for facts before committing.', 'Check condition, who is attending and whether a doctor is available.'],
    },
    {
      id: 'tc-es3-decision', title: 'Decision and set-up', phase: 'Cruise; medical diversion planning', environment: 'Level flight; three airport choices',
      distracters: ['Dispatch mentions connecting passengers at the destination'], trigger: 'Doctor assessment relayed by the cabin',
      technical: 'Route and cleared heading set-up', crm: 'Decision making and communication',
      objective: 'Weigh the time to hospital against runway and weather risk, request a medical diversion, set route and heading, inform dispatch, complete the diversion checklist and brief the cabin.',
      instructorNotes: 'All procedures, medical urgency, facilities, runway/weather numbers and grading judgments are invented, to be validated by the user (a pilot). Selwick Reach is best: 25 minutes away with a nearby hospital, long dry runway and good weather. Brindle Fen is accepted but graded 2 for the uncorrected minor risk choice: 15 minutes away with a short wet runway and crosswind near the fictional limit. Continuing to Tarnelow Bay takes 1 hour 40 minutes; dispatch raises one concern and offers reconsideration. Confirming continue is a safety issue and grades 1. No descent or landing is simulated. Diversion ends only after the matching route and cleared heading are set, the aircraft is turning onto that heading in level flight, and the cabin has been briefed. The cabin brief, dispatch confirmation and diversion checklist may be completed in any order; all are required before the diversion ends. A vague dispatch reply costs one grade point and opens a new clarification message; both replies confirm the diversion and advance coordination. The setup check remains independent, so a missing dispatch reply or checklist is graded separately at timeout. Timeout reminder is suppressed after a committed decision or while the dispatch concern is open.',
      startCues: [
        { kind: 'message', id: 'tc-doctor-assessment', channel: 'cabin', text: 'The doctor says the passenger needs hospital care within the hour. Their condition remains serious. Please tell us the plan.' },
        { kind: 'printout', id: 'tc-airport-options', title: 'Dispatch: medical diversion options', body: `${LARGE}: 25 minutes flying time. Large airport, runway 3,100 m, dry, clear weather, wind 060 at 5 kt, visibility over 10 km. Hospital close by; medical team can meet the aircraft. ${NEAR}: nearest, 15 minutes flying time. Small airport, runway 1,550 m, wet, rain, visibility 5 km, crosswind 24 kt near the fictional 25 kt limit. Hospital transfer availability unconfirmed. ${DEST}: 1 hour 40 minutes flying time. Good weather and medical facilities, but beyond the doctor's one-hour request. Times are fictional estimates, not guarantees of hospital arrival.` },
        { kind: 'message', id: 'tc-dispatch-connections', channel: 'dispatch', text: `${DEST} has connecting passengers waiting. Let us know your plan so we can handle the connections.` },
        { kind: 'message', id: 'tc-intentions', channel: 'atc', text: `${CALLSIGN}, advise your intentions.`, cards: DECISION_CARDS },
        { kind: 'checklistAvailable', checklistId: 'tc-diversion' },
      ],
      rules: [
        clearance('large', LARGE, 70), clearance('near', NEAR, 150),
        dispatchFollowUp('large', LARGE), dispatchFollowUp('near', NEAR),
        { id: 'tc-dispatch-concern', instructorLabel: 'One dispatch concern after the initial continue choice; diversion still available', when: replied({ cardId: 'tc-continue' }), cues: [{ kind: 'message', id: 'tc-continue-concern', channel: 'dispatch', text: `${DEST} is 1 hour 40 minutes away. That exceeds the doctor's request for hospital care within the hour. Confirm continue or reconsider the diversion.`, cards: [...DIVERSION_CARDS, { id: 'tc-confirm-continue', text: `Confirm continue to ${DEST} despite that delay.` }] }] },
        { id: 'tc-atc-continue', instructorLabel: 'Confirmed continue relayed to ATC', when: CONFIRMED_CONTINUE, cues: [{ kind: 'message', id: 'tc-atc-continue-ack', channel: 'atc', text: `${CALLSIGN}, continue as cleared, maintain 26,000 feet.` }] },
        { id: 'tc-dispatch-copy', instructorLabel: 'Pilot explicitly informs dispatch; medical team requested', when: DISPATCH_INFORMED, cues: [{ kind: 'message', id: 'tc-dispatch-ack', channel: 'dispatch', text: 'Medical diversion copied. We are coordinating the hospital transfer with the airport.' }] },
        { id: 'tc-fo-route', instructorLabel: 'First officer names the route selected after an accepted diversion request', when: any(all(fired('tc-clear-large'), st('destination', 'eq', 'tc-large')), all(fired('tc-clear-near'), st('destination', 'eq', 'tc-near'))), cues: [{ kind: 'message', id: 'tc-crew-route', channel: 'crew', text: 'The selected route matches the diversion clearance.' }] },
        { id: 'tc-cabin-open', instructorLabel: 'A committed plan and cabin-call button open the cabin briefing', when: all(DECIDED, control('pa.cabin', true)), cues: [{ kind: 'message', id: 'tc-cabin-brief', channel: 'cabin', text: 'Captain, we are ready for your plan and next update.', cards: [{ id: 'tc-cabin-clear', text: 'We have a serious medical situation. We have made our route decision and will update you shortly. Keep the doctor informed; call immediately if the condition changes. I will update you when the plan changes.' }, { id: 'tc-cabin-vague', text: 'We have made a plan. More later.' }] }] },
      ],
      endWhen: at(99999), // Last set ends only through endConditions or softTimeout.
      checks: [
        { kind: 'required', id: 'tc-decision-made', when: DECIDED, withinSec: 110, category: 'crm', reason: 'A route decision was not communicated promptly.' },
        { kind: 'required', id: 'tc-decision-setup', when: any(DIVERSION_SET_UP, CONTINUE_CONFIRMED), category: 'automation', reason: 'The diversion route, cleared heading and cabin briefing were not completed.' },
        { kind: 'required', id: 'tc-decision-dispatch', when: any(DISPATCH_INFORMED, CONFIRMED_CONTINUE), category: 'crm', reason: 'Dispatch was not informed of the selected medical diversion.' },
        { kind: 'required', id: 'tc-decision-checklist', when: any(DIVERSION_DONE, CONFIRMED_CONTINUE), category: 'procedures', reason: 'The diversion checklist was not completed.' },
        { kind: 'comm', id: 'tc-decision-dispatch-large-quality', messageId: 'tc-dispatch-large', quality: { 'tc-dispatch-informed': 'good', 'tc-dispatch-vague': 'poor' }, category: 'crm', reason: 'The dispatch reply did not confirm the diversion airport and need for hospital care.' },
        { kind: 'comm', id: 'tc-decision-dispatch-near-quality', messageId: 'tc-dispatch-near', quality: { 'tc-dispatch-informed': 'good', 'tc-dispatch-vague': 'poor' }, category: 'crm', reason: 'The dispatch reply did not confirm the diversion airport and need for hospital care.' },
        { kind: 'comm', id: 'tc-decision-dispatch-large-clarity', messageId: 'tc-dispatch-clarify-large', quality: { 'tc-dispatch-informed': 'good', 'tc-dispatch-brief': 'acceptable' }, category: 'crm', reason: 'The clarification was not answered.' },
        { kind: 'comm', id: 'tc-decision-dispatch-near-clarity', messageId: 'tc-dispatch-clarify-near', quality: { 'tc-dispatch-informed': 'good', 'tc-dispatch-brief': 'acceptable' }, category: 'crm', reason: 'The clarification was not answered.' },
        { kind: 'comm', id: 'tc-decision-cabin-quality', messageId: 'tc-cabin-brief', quality: { 'tc-cabin-clear': 'good', 'tc-cabin-vague': 'poor' }, category: 'crm', reason: 'The cabin briefing did not explain the situation, coordination and next update.' },
        { kind: 'errorTrap', id: 'tc-decision-nearest', when: replied({ cardId: 'tc-divert-near' }), severity: 'minor', category: 'crm', reason: 'The nearest airport saved ten minutes but added a short wet runway, near-limit crosswind and uncertain hospital transfer.' },
        { kind: 'safety', id: 'tc-decision-continue-safety', when: CONFIRMED_CONTINUE, category: 'crm', reason: 'Continuing was confirmed despite the doctor requesting hospital care within the hour and the destination being 1 hour 40 minutes away.' },
      ],
      hints: ['The kneeboard compares flight time, runway, weather and hospital access.', 'Reply to ATC, then compare the cleared heading and airport with the autopilot and route panel.', 'Dispatch has a reply card. The diversion checklist and CABIN CALL button cover the remaining coordination.'],
    },
  ],
  endConditions: [{ reason: 'diversionSetUp', when: all(DIVERSION_SET_UP, DIVERSION_DONE, DISPATCH_INFORMED) }, { reason: 'continueConfirmed', when: CONTINUE_CONFIRMED }],
  softTimeout: {
    eventSetId: 'tc-es3-decision', promptAtSec: 120, afterSec: 180, skipPromptWhen: any(DECIDED, fired('tc-dispatch-concern')),
    promptCue: { kind: 'message', id: 'tc-timeout-reminder', channel: 'atc', text: `${CALLSIGN}, still awaiting your intentions. Please advise.`, cards: DECISION_CARDS },
  },
}, VOICED_MESSAGE_IDS));
