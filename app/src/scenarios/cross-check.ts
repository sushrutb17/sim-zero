// Original, fictional content for the generic cockpit. No airline documents or real procedures.
// Every checklist, communication sequence, timing and decision criterion below is invented:
// to be validated by the user (a pilot). This is scenario-management practice, not a certified procedure.
import { parseScenario, type Scenario } from '../contracts/scenario';
import { VOICED_MESSAGE_IDS } from './single-source.voice';
import { withVoice } from './voice';
import { st, all, any, at, fired, replied, allTicked, between } from './dsl';

const CALLSIGN = 'Corvane 471';
const OTHER = 'Corvane 417'; // The company flight with a similar callsign on the same frequency.
const DEP = 'Ashcombe';
const DEST = 'Larkspur Vale';
const FREQ = '118.70'; // Fictional facility assignment.

const AMENDED_ITEMS = [
  { id: 'cc-am-altitude', text: 'Autopilot altitude - SET to the amended 5,000 ft' },
  { id: 'cc-am-heading', text: 'Autopilot heading - SET to the amended 240' },
  { id: 'cc-am-altimeter', text: 'Altimeter - SET to the amended QNH 1008' },
  { id: 'cc-am-brief', text: 'Takeoff briefing - UPDATED for the amended departure' },
];
const AMENDED_DONE = allTicked('cc-amended', AMENDED_ITEMS.map((i) => i.id));

// Event Set 1: the three settings the amended clearance changes.
const SETTINGS_RIGHT = all(st('ap.alt', 'eq', 5000), st('ap.hdg', 'eq', 240), st('baroHpa', 'eq', 1008));
const SETTINGS_WRONG = any(st('ap.alt', 'neq', 5000), st('ap.hdg', 'neq', 240), st('baroHpa', 'neq', 1008));
// Event Set 2: autopilot engaged with the climb mode (CLB) is the only way the aircraft climbs.
const CLIMBING_SET = all(st('ap.engaged', 'eq', true), st('ap.vertical', 'eq', 'climb'));
const REAL_READBACK = replied({ cardId: 'cc-real-readback' });
// Event Set 3: level at the stop altitude, standard setting, cabin call answered.
const STOP_SET = st('ap.alt', 'eq', 11000);
const AT_STOP = between('altitudeFt', 10990, 11010); // the autopilot clamps onto its target, so the aircraft always lands inside this band
const CABIN_ANSWERED = any(replied({ messageId: 'cc-cabin-galley', cardId: 'cc-cabin-goahead' }), replied({ messageId: 'cc-cabin-callback' }));
const COMPLETED = all(STOP_SET, AT_STOP, st('baroHpa', 'eq', 1013), CABIN_ANSWERED);

export const crossCheck: Scenario = parseScenario(withVoice({
  id: 'cross-check',
  title: 'Cross-Check',
  notice: 'Generic fictional aircraft for scenario-management practice only. These are invented, not real or approved procedures. Voices are computer-generated.',
  // 3, not 6: the autopilot climbs 2500 ft/min = 41.7 ft per scenario second, times 3 = 125 ft per real second (250 at 6), and turns 3 x 3 = 9 degrees per real second.
  // Scenario timing (atSec, afterSec, ...) stays in real seconds. It is slower than the other flights so that the Event Set 3 stop call always leaves time to set 11000 (arithmetic at softTimeout).
  timeCompression: 3,
  latenessGraceSec: 10,
  initialAircraft: {
    altitudeFt: 0, headingDeg: 270, speedKt: 0, phase: 'holding',
    ap: { engaged: false, hdg: 270, alt: 4000, lateral: 'hdg', vertical: 'hold' },
    baroHpa: 1011, lights: { landing: true, strobe: true },
    elec: { gen1: { switchOn: true, failed: false }, gen2: { switchOn: true, failed: false }, backupGenInop: false, busTie: false },
    comFreq: FREQ, destination: 'cc-dest', stormBearingDeg: null,
  },
  briefing: [
    { id: 'cc-flight', title: 'Your flight', body: `${CALLSIGN}, from ${DEP} to ${DEST}. You are holding short of runway 27 with both exterior lights on. You operate all controls; the first officer gives factual callouts only. A company flight with a similar callsign, ${OTHER}, is on the same frequency. All names and operating details are fictional.` },
    { id: 'cc-plan', title: 'Planned departure', body: 'Planned clearance: runway 27, heading 270 after takeoff, climb to 4,000 ft, altimeter QNH 1011. The autopilot is set to these numbers. The transition altitude is 6,000 ft: above it the altimeter is set to the standard 1013.' },
    { id: 'cc-how', title: 'How it works', body: 'Tap reply cards to speak. Read printouts on the kneeboard. Complete checklist lines on the lower left. After takeoff the aircraft climbs only with the autopilot engaged in climb mode (CLB). This exercise does not include descent, approach or landing.' },
  ],
  airports: [{ id: 'cc-dep', name: DEP }, { id: 'cc-dest', name: DEST }],
  checklists: [{ id: 'cc-amended', title: 'AMENDED DEPARTURE', items: AMENDED_ITEMS }],
  practice: { controlId: 'practice.toggle', prompt: 'Practice: poke the PRACTICE switch with your fingertip to turn it on.' },
  eventSets: [
    {
      id: 'cc-es1-late-change', title: 'Late change', phase: 'Holding short, runway 27', environment: 'Clear day, light wind, busy tower frequency',
      distracters: ['Tower offers an immediate departure while the aircraft is still set for the old clearance'], trigger: 'Tower issues an amended departure clearance',
      technical: 'Resetting autopilot targets and the altimeter to an amended clearance', crm: 'Cross-checking the numbers before accepting a time-pressured offer',
      objective: 'Read back the amended clearance, set altitude, heading and altimeter to the new numbers, complete the AMENDED DEPARTURE checklist and only then accept the departure.',
      instructorNotes: 'Invented departure sequence, to be validated by the user (a pilot). The amended clearance changes three numbers (5,000 ft, heading 240, QNH 1008); the briefing and the initial settings hold the old ones. A wrong read-back costs a grade point and Tower repeats the numbers. About 4 s after the read-back (or 20 s into the set) Tower offers an immediate departure. Either answer is fine; accepting the immediate departure while any of the three settings is still old is a major error that is corrected if all three are right before the takeoff read-back. Answering "standby" gives Tower a report-ready call, then the takeoff clearance. With no reply at all the takeoff clearance follows by itself and the aircraft takes off about 15 s later, so a stuck pilot still reaches the next set; the missing work is graded.',
      startCues: [
        { kind: 'checklistAvailable', checklistId: 'cc-amended' },
        { kind: 'message', id: 'cc-twr-amend', channel: 'atc', text: `${CALLSIGN}, amended departure clearance: after takeoff turn left heading 240, climb 5,000 feet, QNH 1008.`, cards: [{ id: 'cc-amend-readback', text: `Heading 240, climb 5,000 feet, QNH 1008, ${CALLSIGN}.` }, { id: 'cc-amend-wrong', text: `Heading 240, climb 4,000 feet, QNH 1008, ${CALLSIGN}.` }] },
      ],
      rules: [
        { id: 'cc-amend-good', instructorLabel: 'Correct read-back: Tower confirms', when: replied({ cardId: 'cc-amend-readback' }), cues: [{ kind: 'message', id: 'cc-twr-readback-ok', channel: 'atc', text: `${CALLSIGN}, readback correct.` }] },
        { id: 'cc-amend-bad', instructorLabel: 'Read-back with a wrong number: Tower repeats the amended numbers', when: replied({ cardId: 'cc-amend-wrong' }), cues: [{ kind: 'message', id: 'cc-twr-amend-correct', channel: 'atc', text: `${CALLSIGN}, negative. Heading 240, climb 5,000 feet, QNH 1008.` }] },
        {
          id: 'cc-ready-q', instructorLabel: 'Tower offers an immediate departure (4 s after the read-back confirmation, or 20 s into the set)',
          when: any(fired('cc-amend-good', 4), fired('cc-amend-bad', 5), at(20)),
          cues: [{ kind: 'message', id: 'cc-twr-ready', channel: 'atc', text: `${CALLSIGN}, are you ready for an immediate departure?`, cards: [{ id: 'cc-ready-now', text: `Ready for immediate departure, ${CALLSIGN}.` }, { id: 'cc-ready-standby', text: `Standby, resetting for the amended clearance, ${CALLSIGN}.` }] }],
        },
        { id: 'cc-report', instructorLabel: 'Standby: Tower asks for a call when ready', when: replied({ cardId: 'cc-ready-standby' }), cues: [{ kind: 'message', id: 'cc-twr-report', channel: 'atc', text: `${CALLSIGN}, report ready for departure.`, cards: [{ id: 'cc-report-ready', text: `Ready for departure, ${CALLSIGN}.` }] }] },
        {
          id: 'cc-takeoff-clear', instructorLabel: 'Takeoff clearance: after "ready" or the report-ready call; by itself 15 s after the report call or 25 s after the offer',
          when: any(replied({ cardId: 'cc-ready-now' }), replied({ cardId: 'cc-report-ready' }), fired('cc-report', 15), fired('cc-ready-q', 25)),
          cues: [{ kind: 'message', id: 'cc-twr-takeoff', channel: 'atc', text: `${CALLSIGN}, wind 270 at 6 knots, runway 27, cleared for takeoff.`, cards: [{ id: 'cc-takeoff-readback', text: `Runway 27, cleared for takeoff, ${CALLSIGN}.` }, { id: 'cc-takeoff-vague', text: 'Cleared for takeoff.' }] }],
        },
        {
          id: 'cc-takeoff', instructorLabel: 'Takeoff: the aircraft rolls and is hand-flown to 800 ft once the clearance is answered (by itself 15 s after the clearance)',
          when: any(replied({ messageId: 'cc-twr-takeoff' }), fired('cc-takeoff-clear', 15)),
          cues: [{ kind: 'aircraft', patch: { phase: 'takeoff', speedKt: 170, altitudeFt: 800 } }],
          physical: true,
        },
      ],
      endWhen: fired('cc-takeoff'),
      checks: [
        { kind: 'comm', id: 'cc-es1-amend-quality', messageId: 'cc-twr-amend', quality: { 'cc-amend-readback': 'good', 'cc-amend-wrong': 'poor' }, category: 'crm', reason: 'The amended clearance was not read back correctly.' },
        { kind: 'comm', id: 'cc-es1-ready-quality', messageId: 'cc-twr-ready', quality: { 'cc-ready-now': 'good', 'cc-ready-standby': 'good' }, category: 'crm', reason: 'The offer of an immediate departure was not answered.' },
        { kind: 'comm', id: 'cc-es1-report-quality', messageId: 'cc-twr-report', quality: { 'cc-report-ready': 'good' }, category: 'crm', reason: 'The report-ready call was not answered.' },
        { kind: 'comm', id: 'cc-es1-takeoff-quality', messageId: 'cc-twr-takeoff', quality: { 'cc-takeoff-readback': 'good', 'cc-takeoff-vague': 'poor' }, category: 'crm', reason: 'The takeoff clearance was not read back with the runway.' },
        { kind: 'required', id: 'cc-es1-alt', when: st('ap.alt', 'eq', 5000), category: 'automation', reason: 'The autopilot altitude was not set to the amended 5,000 ft before takeoff.' },
        { kind: 'required', id: 'cc-es1-hdg', when: st('ap.hdg', 'eq', 240), category: 'automation', reason: 'The autopilot heading was not set to the amended 240 before takeoff.' },
        { kind: 'required', id: 'cc-es1-baro', when: st('baroHpa', 'eq', 1008), category: 'procedures', reason: 'The altimeter was not set to the amended QNH 1008 before takeoff.' },
        { kind: 'required', id: 'cc-es1-checklist', when: AMENDED_DONE, category: 'procedures', reason: 'The AMENDED DEPARTURE checklist was not completed before takeoff.' },
        { kind: 'errorTrap', id: 'cc-es1-immediate', when: all(replied({ cardId: 'cc-ready-now' }), SETTINGS_WRONG), trappedWhen: SETTINGS_RIGHT, severity: 'major', category: 'procedures', reason: 'An immediate departure was accepted while the altitude, heading or altimeter still held the old numbers.' },
      ],
      hints: ['The amended clearance is on the comms panel; the planned numbers are in the briefing on the kneeboard.', 'The autopilot panel and the altimeter show what is set now. The AMENDED DEPARTURE checklist is lower left.', 'Compare the altitude, heading and altimeter with the amended clearance before you say you are ready.'],
    },
    {
      id: 'cc-es2-similar-callsign', title: 'Similar callsign', phase: 'Climb after takeoff', environment: 'Clear, busy departure frequency',
      distracters: [`A clearance for ${OTHER} arrives on the same frequency`], trigger: `ATC calls ${OTHER} with a climb to flight level 160`,
      technical: 'Autopilot climb set-up and the altitude target', crm: 'Callsign discipline: checking that a clearance is for you',
      objective: `Engage the autopilot in climb mode, notice that the flight level 160 call was for ${OTHER}, then read back and set your own clearance, flight level 140.`,
      instructorNotes: `Invented sequence, to be validated by the user (a pilot). The aircraft climbs only with the autopilot engaged in climb mode; the first officer says so if it is not set 14 s into the set. About 3,000 ft (or 25 s into the set) ATC calls ${OTHER} with flight level 160. Asking "was that for Corvane 471" is best; "not our callsign" is acceptable; reading the clearance back as Corvane 471 is a poor reply. Whatever the pilot does, ATC then gives Corvane 471 its real clearance, flight level 140 (3 s after its own correction, or at once, or 12 s after the call if the pilot said nothing). Setting the autopilot to 16000 is a major error, corrected when it is reset to 14000 within 30 s. The set ends when the real clearance is read back and 14000 is set; it also ends when the aircraft reaches 8,500 ft after the real clearance (so the level-off call of the next set always comes at least 20 s before flight level 110: the aircraft climbs 125 ft each real second) or 30 s after the real clearance. So the correction has to come before 8,500 ft, which is at least 28 s after a clearance that arrives at 5,000 ft. A missing read-back or altitude is graded; the flight does not stop.`,
      startCues: [
        { kind: 'message', id: 'cc-dep-contact', channel: 'atc', text: `${CALLSIGN}, ${DEP} Departure, radar contact. Continue climb to 5,000 feet.`, cards: [{ id: 'cc-dep-readback', text: `Climb 5,000 feet, ${CALLSIGN}.` }] },
      ],
      rules: [
        { id: 'cc-fo-positive', instructorLabel: 'First officer: positive climb', when: at(2), cues: [{ kind: 'message', id: 'cc-crew-positive', channel: 'crew', text: 'Positive climb.' }] },
        { id: 'cc-fo-climb-mode', instructorLabel: 'First officer notes the aircraft is not climbing (14 s into the set)', when: all(at(14), any(st('ap.engaged', 'eq', false), st('ap.vertical', 'neq', 'climb'))), cues: [{ kind: 'message', id: 'cc-crew-mode', channel: 'crew', text: 'The aircraft is not climbing. The autopilot is not engaged in climb mode.' }] },
        {
          id: 'cc-call-417', instructorLabel: `ATC calls ${OTHER} with a climb to flight level 160 (passing 3,000 ft, at least 6 s into the set, or 25 s into the set)`,
          when: all(at(6), any(st('altitudeFt', 'gte', 3000), at(25))),
          cues: [{ kind: 'message', id: 'cc-atc-417', channel: 'atc', text: `${OTHER}, climb flight level 160.`, cards: [{ id: 'cc-say-again', text: `Say again, was that for ${CALLSIGN}?` }, { id: 'cc-not-ours', text: 'Not our callsign. No transmission.' }, { id: 'cc-readback-160', text: `Climb flight level 160, ${CALLSIGN}.` }] }],
        },
        { id: 'cc-query', instructorLabel: 'Pilot asks whether the call was for us: ATC answers', when: replied({ cardId: 'cc-say-again' }), cues: [{ kind: 'message', id: 'cc-atc-for-417', channel: 'atc', text: `${CALLSIGN}, that call was for ${OTHER}.` }] },
        { id: 'cc-negative', instructorLabel: 'Pilot read back the other flight clearance: ATC corrects', when: replied({ cardId: 'cc-readback-160' }), cues: [{ kind: 'message', id: 'cc-atc-negative', channel: 'atc', text: `${CALLSIGN}, negative. That clearance was for ${OTHER}.` }] },
        {
          id: 'cc-real', instructorLabel: 'ATC gives the real clearance, flight level 140 (3 s after the answer or correction, at once after "not our callsign", or 12 s after the call with no reply)',
          when: any(fired('cc-query', 3), fired('cc-negative', 3), replied({ cardId: 'cc-not-ours' }), fired('cc-call-417', 12)),
          cues: [{ kind: 'message', id: 'cc-atc-real', channel: 'atc', text: `${CALLSIGN}, climb flight level 140.`, cards: [{ id: 'cc-real-readback', text: `Climb flight level 140, ${CALLSIGN}.` }] }],
        },
      ],
      endWhen: any(all(REAL_READBACK, st('ap.alt', 'eq', 14000)), all(fired('cc-real'), st('altitudeFt', 'gte', 8500)), fired('cc-real', 30)),
      checks: [
        { kind: 'comm', id: 'cc-es2-dep-quality', messageId: 'cc-dep-contact', quality: { 'cc-dep-readback': 'good' }, category: 'crm', reason: 'The departure climb instruction was not read back.' },
        { kind: 'comm', id: 'cc-es2-417-quality', messageId: 'cc-atc-417', quality: { 'cc-say-again': 'good', 'cc-not-ours': 'acceptable', 'cc-readback-160': 'poor' }, category: 'crm', reason: `A clearance for ${OTHER} was read back as ${CALLSIGN}.` },
        { kind: 'comm', id: 'cc-es2-real-quality', messageId: 'cc-atc-real', quality: { 'cc-real-readback': 'good' }, category: 'crm', reason: 'The flight level 140 clearance was not read back.' },
        { kind: 'required', id: 'cc-es2-climb', when: CLIMBING_SET, category: 'automation', reason: 'The autopilot was not engaged in climb mode, so the aircraft could not climb.' },
        { kind: 'required', id: 'cc-es2-readback', when: REAL_READBACK, category: 'crm', reason: `The clearance for ${CALLSIGN}, flight level 140, was not read back.` },
        { kind: 'required', id: 'cc-es2-alt', when: st('ap.alt', 'eq', 14000), category: 'automation', reason: 'The autopilot altitude was not set to flight level 140.' },
        { kind: 'errorTrap', id: 'cc-es2-wrong-level', when: st('ap.alt', 'eq', 16000), trappedWhen: st('ap.alt', 'eq', 14000), trapWithinSec: 30, severity: 'major', category: 'procedures', reason: `The autopilot was set to flight level 160, the level cleared for ${OTHER}.` },
      ],
      hints: ['The callsign in each ATC call is on the comms panel.', 'The autopilot panel shows the engage button and the climb mode.', 'Compare the flight level in your own clearance with the altitude set on the autopilot.'],
    },
    {
      id: 'cc-es3-level-off', title: 'Level-off', phase: 'Climb through the transition altitude', environment: 'Clear, traffic above',
      distracters: ['A harmless galley fault is reported by the cabin at the moment of the stop call'], trigger: 'ATC stops the climb at flight level 110',
      technical: 'Altitude target and the standard altimeter setting', crm: 'Prioritising the aircraft before a non-urgent cabin call',
      objective: 'Set the autopilot to flight level 110 before the aircraft reaches it, set the standard altimeter setting above the transition altitude and answer the cabin call once the aircraft is looked after.',
      instructorNotes: 'Invented sequence, to be validated by the user (a pilot). The level-off call and the cabin call come together passing 6,000 ft (or 30 s into the set if the aircraft is not climbing). The aircraft climbs 125 ft each real second, so from the moment of the call the pilot has at least 20 s to set 11000 (22 s before the 11,300 ft safety limit) when the previous set ended at its 8,500 ft cap, and about 40 s on the usual path, when the call comes passing 6,000 ft. Climbing 300 ft or more through the stop altitude is a safety issue (grade 1); setting 11000 afterwards makes the aircraft return to it and the flight can still complete. Telling the cabin to go ahead (on the first call or the call-back) before setting 11000 is a minor prioritisation error, corrected if 11000 is then set before the aircraft reaches it; answering "standby" is the better answer and is never an error. After a standby the cabin calls again 8 s later; an unanswered first call keeps its reply cards on the comms panel. The flight completes when the aircraft is level at 11,000 ft with the autopilot set to 11000 and the altimeter at 1013, and the cabin call is answered. If this does not happen, the ATC reminder comes at 120 s and the flight times out at 140 s (a pilot who only sets 11000 after flying up to flight level 140 still completes at about 112 s). The cabin fault is harmless: no smoke, nobody hurt.',
      startCues: [],
      rules: [
        { id: 'cc-fo-transition', instructorLabel: 'First officer calls the transition altitude', when: st('altitudeFt', 'gte', 6000), cues: [{ kind: 'message', id: 'cc-crew-transition', channel: 'crew', text: 'Passing the transition altitude, 6,000 feet.' }] },
        {
          id: 'cc-stop', instructorLabel: 'ATC stops the climb at flight level 110; the cabin calls about a galley fault (passing 6,000 ft, or 30 s into the set)',
          when: any(st('altitudeFt', 'gte', 6000), at(30)),
          cues: [
            { kind: 'message', id: 'cc-atc-stop', channel: 'atc', text: `${CALLSIGN}, stop climb at flight level 110, traffic above.`, cards: [{ id: 'cc-stop-readback', text: `Stop climb flight level 110, ${CALLSIGN}.` }, { id: 'cc-stop-wrong', text: `Stop climb flight level 100, ${CALLSIGN}.` }] },
            { kind: 'message', id: 'cc-cabin-galley', channel: 'cabin', text: 'Captain, the galley water heater has failed. There is no smoke and nobody is hurt. Can you talk now?', cards: [{ id: 'cc-cabin-standby', text: 'Standby, we will call you back.' }, { id: 'cc-cabin-goahead', text: 'Go ahead.' }] },
          ],
        },
        { id: 'cc-cabin-wait', instructorLabel: 'Standby: the cabin waits', when: replied({ cardId: 'cc-cabin-standby' }), cues: [{ kind: 'message', id: 'cc-cabin-ok', channel: 'cabin', text: 'Understood. We will wait for your call.' }] },
        {
          id: 'cc-cabin-recall', instructorLabel: 'The cabin calls again 8 s after the standby (an unanswered first call keeps its cards)',
          when: fired('cc-cabin-wait', 8),
          cues: [{ kind: 'message', id: 'cc-cabin-callback', channel: 'cabin', text: 'Captain, the galley supervisor is ready to report when you are.', cards: [{ id: 'cc-callback-go', text: 'Go ahead with your report.' }] }],
        },
        {
          id: 'cc-cabin-report', instructorLabel: 'The cabin reports: heater isolated, nothing needed',
          when: any(replied({ messageId: 'cc-cabin-galley', cardId: 'cc-cabin-goahead' }), replied({ messageId: 'cc-cabin-callback' })),
          cues: [{ kind: 'message', id: 'cc-cabin-report', channel: 'cabin', text: 'The water heater is switched off and the galley is safe. Nothing more is needed from you.' }],
        },
      ],
      endWhen: at(99999), // Last set ends only through endConditions or softTimeout.
      checks: [
        { kind: 'comm', id: 'cc-es3-stop-quality', messageId: 'cc-atc-stop', quality: { 'cc-stop-readback': 'good', 'cc-stop-wrong': 'poor' }, category: 'crm', reason: 'The stop-climb instruction was not read back with the right level.' },
        { kind: 'comm', id: 'cc-es3-cabin-quality', messageId: 'cc-cabin-galley', quality: { 'cc-cabin-standby': 'good', 'cc-cabin-goahead': 'acceptable' }, category: 'crm', reason: 'The cabin call was not answered.' },
        { kind: 'comm', id: 'cc-es3-callback-quality', messageId: 'cc-cabin-callback', quality: { 'cc-callback-go': 'good' }, category: 'crm', reason: 'The cabin call-back was not answered.' },
        { kind: 'comm', id: 'cc-es3-reminder-quality', messageId: 'cc-timeout-reminder', quality: { 'cc-level-confirm': 'good', 'cc-level-working': 'acceptable' }, category: 'crm', reason: 'The ATC reminder about the level was not answered.' },
        { kind: 'required', id: 'cc-es3-stop-alt', when: STOP_SET, category: 'automation', reason: 'The autopilot altitude was not set to flight level 110.' },
        { kind: 'required', id: 'cc-es3-baro', when: st('baroHpa', 'eq', 1013), withinSec: 60, category: 'procedures', reason: 'The altimeter was not set to the standard 1013 above the transition altitude.' },
        { kind: 'required', id: 'cc-es3-cabin', when: CABIN_ANSWERED, category: 'crm', reason: 'The cabin call was not answered.' },
        { kind: 'safety', id: 'cc-es3-overshoot', when: st('altitudeFt', 'gte', 11300), category: 'handling', reason: 'The aircraft climbed more than 300 ft through the stop altitude, flight level 110.' },
        { kind: 'errorTrap', id: 'cc-es3-prioritise', when: all(any(replied({ cardId: 'cc-cabin-goahead' }), replied({ cardId: 'cc-callback-go' })), st('ap.alt', 'neq', 11000)), trappedWhen: all(STOP_SET, st('altitudeFt', 'lte', 10999)), severity: 'minor', category: 'crm', reason: 'The cabin was asked to go ahead before the aircraft was set to stop at flight level 110.' },
      ],
      hints: ['The level-off call and the cabin call are both on the comms panel. Which one affects the aircraft?', 'The autopilot altitude and the altimeter setting are on the glareshield panel. The briefing gives the transition altitude.', 'The aircraft climbs quickly. Check the autopilot altitude before the aircraft reaches the stop level.'],
    },
  ],
  endConditions: [{ reason: 'completed', when: COMPLETED }],
  // Event Set 3 timing, in real seconds into the set, at 125 ft per second. The slowest competent path: the set starts as low as about 3,000 ft
  // (the real clearance read back and 14000 set the moment it is given, after "not our callsign" at the 3,000 ft call), so the stop call
  // (passing 6,000 ft) is 3,000 / 125 = 24 s in. A pilot who only sets 11000 once the aircraft has reached the full flight level 140
  // needs (14,000 - 6,000) / 125 = 64 s to climb there, then (14,000 - 11,000) / 125 = 24 s for the autopilot to bring it back:
  // 24 + 64 + 24 = 112 s. Baro 1013 and the cabin call-back are done on the way up, inside that time. The timeout is 140 s: 28 s spare
  // (20 s required, and about 8 s for the presses at 14000 in the emulator). The reminder is at 120 s, after that path completes and
  // before the timeout, and it is skipped for any pilot who is already level at 11,000 ft.
  softTimeout: {
    eventSetId: 'cc-es3-level-off', promptAtSec: 120, afterSec: 140, skipPromptWhen: all(STOP_SET, AT_STOP),
    promptCue: { kind: 'message', id: 'cc-timeout-reminder', channel: 'atc', text: `${CALLSIGN}, confirm you are level at flight level 110.`, cards: [{ id: 'cc-level-confirm', text: `Level flight level 110, ${CALLSIGN}.` }, { id: 'cc-level-working', text: `Not yet level, working on it, ${CALLSIGN}.` }] },
  },
}, VOICED_MESSAGE_IDS));
