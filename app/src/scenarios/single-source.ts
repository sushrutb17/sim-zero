// "Single Source": the training scenario (spec section 4.2). Content only: no engine or UI code.
//
// Everything here is ORIGINAL and written for a GENERIC, FICTIONAL aircraft, airline and airports.
// Checklists, switch sequences and expected actions are INVENTED for scenario-management practice
// and are not real or approved procedures. Pilot-visible text must stay printable ASCII (the
// headset font has no glyphs for curly quotes, dashes, bullets or arrows).
//
// Runtime rules this file relies on (see the comment above crossCheck in contracts/scenario.ts):
// rules run only while their set is current; reply cards belong to the set that sent them, and the
// comms panel keeps the cards of every unanswered message of the current set available until one is
// chosen. Event Sets 1-3 also end after 150 s so a stuck user always reaches the debrief.
import { parseScenario, type Condition, type Scenario } from '../contracts/scenario';
import { VOICED_MESSAGE_IDS } from './single-source.voice';
import { withVoice } from './voice';
import { st, all, any, at, fired, replied, control, ticked, allTicked, between, litReply, litCard, litControl } from './dsl';

// --- Condition helpers ------------------------------------------------------------------------
const destIs = (...ids: string[]): Condition => any(...ids.map((id) => st('destination', 'eq', id)));

// --- Names (all invented) ---------------------------------------------------------------------
const CALLSIGN = 'Orvessa 214';
const DEP = 'Port Aldane';
const ALT1 = 'Kestry Field';
const ALT2 = 'Isle Morrow';
const DEST = 'Vantreth';
const CENTER_FREQ = '126.85'; // arbitrary, not tied to any real facility

export interface SingleSourceVariation {
  failedGen: 1 | 2;
  goodAlternate: 'alt1' | 'alt2';
  numbers: 0 | 1 | 2;
}

/** Index order is persistent: failed side, suitable alternate, then number set. */
/**
 * Naming convention for the GEN 2 variations: ids and keys that are never shown or voiced keep their baseline names
 * (alert id `gen1-fail`, checklist item ids `gf-gen1-off`, `g3-gen1`, `es3-gen1-off`, printout id `atis-kilo`) so the
 * emulator specs and the guide keep working. The pilot-visible text and the cue ids that carry a voice clip always
 * follow the chosen variation (`<baseline-id>--<tag>`).
 */
export const SINGLE_SOURCE_VARIATIONS: readonly SingleSourceVariation[] = ([1, 2] as const).flatMap(failedGen =>
  (['alt1', 'alt2'] as const).flatMap(goodAlternate =>
    ([0, 1, 2] as const).map(numbers => ({ failedGen, goodAlternate, numbers }))),
);

// INVENTED - VERIFY: reachable with the existing 1 hPa and 1,000 ft buttons.
// Every climb clearance is above the unchanged 10,000 ft fault trigger.
const NUMBER_SETS = [
  { qnh: 1004, atis: 'Kilo', firstAltitude: 4000, climbAltitude: 12000 },
  { qnh: 1002, atis: 'Lima', firstAltitude: 5000, climbAltitude: 13000 },
  { qnh: 1006, atis: 'Mike', firstAltitude: 3000, climbAltitude: 14000 },
] as const;
const memo = new Map<number, Scenario>();
const voiceId = (id: string, ...tags: string[]): string => {
  const tag = tags.filter(Boolean).join('-');
  return tag ? `${id}--${tag}` : id;
};

/** Pure content builder. Stable logical ids retain their baseline names even when a side mirrors. */
export function buildSingleSource(index: number): Scenario {
  if (!Number.isInteger(index) || index < 0 || index >= SINGLE_SOURCE_VARIATIONS.length) {
    throw new RangeError(`Invalid Single Source variation: ${index}`);
  }
  const cached = memo.get(index);
  if (cached) return cached;
  const { failedGen, goodAlternate, numbers } = SINGLE_SOURCE_VARIATIONS[index];
  const workingGen = failedGen === 1 ? 2 : 1;
  const failedKey = failedGen === 1 ? 'gen1' : 'gen2';
  const workingKey = failedGen === 1 ? 'gen2' : 'gen1';
  const { qnh, atis, firstAltitude, climbAltitude } = NUMBER_SETS[numbers];
  const firstText = `${firstAltitude / 1000},000`;
  const climbText = `${climbAltitude / 1000},000`;
  const genTag = failedGen === 1 ? '' : 'g2';
  const numberTag = numbers === 0 ? '' : `n${numbers}`;
  const alternateTag = goodAlternate === 'alt1' ? '' : 'a2';
  const weakAlternate = goodAlternate === 'alt1' ? 'alt2' : 'alt1';
  const goodName = goodAlternate === 'alt1' ? ALT1 : ALT2;
  const weakName = goodAlternate === 'alt1' ? ALT2 : ALT1;
  const goodProfile = '95 nm, over land. Runway 3,200 m, dry. Wind calm, sky clear. Ground handling only, no company maintenance.';
  const weakProfile = '240 nm ahead, over water. Runway 1,900 m. Fog forming, visibility 800 m and falling. Limited rescue and fire cover after dark.';

  // --- Checklists (INVENTED - VERIFY) -----------------------------------------------------------
  const BEFORE_TAKEOFF_ITEMS = [
    { id: 'bt-altimeter', text: 'Altimeter - SET to the latest ATIS QNH' },
    { id: 'bt-autopilot', text: 'Autopilot HDG and ALT - SET to the takeoff data' },
    { id: 'bt-lights', text: 'Landing and strobe lights - ON' },
    { id: 'bt-elec', text: 'Electrical panel - GEN 1 and GEN 2 ON, backup generator INOP noted' },
    { id: 'bt-brief', text: 'Departure briefing - wet runway and storm cells REVIEWED' },
  ];
  const GEN_FAIL_ITEMS = [
    { id: 'gf-identify', text: `GEN ${failedGen} FAULT light - CONFIRM on the overhead ELEC panel` },
    { id: 'gf-gen1-off', text: `GEN ${failedGen} switch - OFF` },
    { id: 'gf-bustie', text: `BUS TIE switch - ON (GEN ${workingGen} then powers both buses)` },
    { id: 'gf-cabin', text: 'Cabin crew - ADVISE, galley power OFF' },
    { id: 'gf-review', text: `Remaining power sources - REVIEW: GEN ${workingGen} only, backup INOP` },
  ];

  // --- Event Set 2 geometry -----------------------------------------------------------------------
  const CLEAR_OF_STORM = any(st('headingDeg', 'lte', 70), st('headingDeg', 'gte', 110));
  const ON_STORM_HEADING = all(st('headingDeg', 'gte', 80), st('headingDeg', 'lte', 100));

  // --- Event Set 4 decision cards -------------------------------------------------------------------
  const DECISION_CARDS = [
    { id: 'dec-return', text: `Request return to ${DEP}, ${CALLSIGN}.` },
    { id: 'dec-divert-alt1', text: `Request diversion to ${ALT1}, ${CALLSIGN}.` },
    { id: 'dec-divert-alt2', text: `Request diversion to ${ALT2}, ${CALLSIGN}.` },
    { id: 'dec-continue', text: `We will continue to ${DEST}, ${CALLSIGN}.` },
  ];
  /** A committed decision: a return/diversion request, or "continue" confirmed after dispatch's concern. */
  const DECIDED = any(
    replied({ cardId: 'dec-return' }),
    replied({ cardId: 'dec-divert-alt1' }),
    replied({ cardId: 'dec-divert-alt2' }),
    replied({ cardId: 'confirm-continue' }),
  );
  const PA_CARDS = [
    {
      id: 'pa-clear',
      text: 'This is the captain. One of our two generators has failed. The aircraft is under control and our plan is agreed with air traffic control. The cabin crew will give you the details.',
    },
    { id: 'pa-short', text: 'This is the captain. We have a technical issue. More information soon.' },
    { id: 'pa-vague', text: 'This is the captain. Nothing to worry about, please enjoy the flight.' },
    { id: 'pa-alarm', text: 'This is the captain. We have a serious emergency. Prepare for the worst.' },
  ];
  const CABIN_INFORMED = replied({ messageId: 'pa-cabin' });
  /** Event Sets 1-3 end after this long even if their tasks are not done (missed checks still grade). */
  const SET_FALLBACK_SEC = 150;
  const COACH_CABIN = 'Recommend you brief the cabin.'; // COACHING - VERIFY (see review doc)
  const DIVERSION_SET_UP = all(
    destIs('dep', 'alt1', 'alt2'),
    any(fired('es4-ack-return'), fired('es4-ack-alt1'), fired('es4-ack-alt2')),
    CABIN_INFORMED,
  );
  const CONTINUE_CONFIRMED = all(replied({ cardId: 'confirm-continue' }), CABIN_INFORMED);

  const ackRule = (ruleId: string, cardId: string, airportName: string, atcExtra: string, dispatchText: string) => ({
    id: ruleId,
    instructorLabel: `ATC clears the aircraft direct ${airportName}; dispatch copies (after card ${cardId})`,
    when: replied({ cardId }),
    cues: [
      {
        kind: 'message' as const,
        id: voiceId(`ctr-ack-${ruleId.replace('es4-ack-', '')}`, numberTag, airportName === DEP ? '' : alternateTag),
        channel: 'atc' as const,
        text: `${CALLSIGN}, roger. Cleared direct ${airportName}, maintain ${climbText} feet. ${atcExtra}`,
      },
      { kind: 'message' as const, id: voiceId(`dsp-ack-${ruleId.replace('es4-ack-', '')}`, airportName === DEP ? '' : alternateTag), channel: 'dispatch' as const, text: `${dispatchText} ${COACH_CABIN}` },
    ],
  });

  // --- First officer callouts (INVENTED - VERIFY): facts only, never what to do next.

  // --- Guided flight steps (T24) ---------------------------------------------------------------------
  // Shown only in GUIDED FLIGHT: the trainer frames the `light` targets and prints `where` and `text`.
  // They only restate what the scenario already expects. Routine replies frame the good card; at a real
  // decision every option is framed and the text never says which one to take. Plain ASCII only.
  const W_COMMS = 'COMMS PANEL, LOW IN FRONT OF YOU';
  const W_AP = 'AUTOPILOT PANEL, BELOW THE WINDSCREEN';
  const W_OVERHEAD = 'OVERHEAD PANEL, ABOVE YOU';
  const W_CHECK = 'CHECKLIST, LOWER LEFT';
  const W_ROUTE = 'ROUTE PANEL, LOWER RIGHT';
  const W_ACK = 'ACK BUTTON, RIGHT END OF THE AUTOPILOT PANEL';

  const lineStep = (id: string, checklistId: string, itemId: string, text: string) => ({
    id,
    where: W_CHECK,
    text,
    light: [{ kind: 'checklistItem' as const, checklistId, itemId }],
    doneWhen: ticked(checklistId, itemId),
  });

  const GUIDE_ES1 = [
    { id: 'g1-hold', where: W_COMMS, text: 'Tower is calling. Press the framed reply to read the instruction back.', light: [litReply(voiceId('twr-hold', numberTag), 'hold-readback')], doneWhen: replied({ messageId: voiceId('twr-hold', numberTag) }) },
    { id: 'g1-baro', where: W_AP, text: `The new weather report gives QNH ${qnh}. Press the framed button until the altimeter reads ${qnh}.`, light: [litControl('baro.set', qnh)], doneWhen: st('baroHpa', 'eq', qnh) },
    { id: 'g1-hdg', where: W_AP, text: 'Set the takeoff heading. Press the framed button until HDG reads 090.', light: [litControl('ap.hdg', 90)], doneWhen: between('ap.hdg', 85, 95) },
    { id: 'g1-alt', where: W_AP, text: `Set the first altitude. Press the framed button until ALT FT reads ${firstAltitude}.`, light: [litControl('ap.alt', firstAltitude)], doneWhen: between('ap.alt', firstAltitude - 100, firstAltitude + 100) },
    { id: 'g1-land', where: W_OVERHEAD, text: 'Switch the LAND light on.', light: [litControl('lights.landing', true)], doneWhen: st('lights.landing', 'eq', true) },
    { id: 'g1-strobe', where: W_OVERHEAD, text: 'Switch the STROBE light on.', light: [litControl('lights.strobe', true)], doneWhen: st('lights.strobe', 'eq', true) },
    lineStep('g1-c1', 'beforeTakeoff', 'bt-altimeter', 'Line 1: the altimeter is set. Press the framed line to confirm it.'),
    lineStep('g1-c2', 'beforeTakeoff', 'bt-autopilot', 'Line 2: heading and altitude are set. Press the framed line.'),
    lineStep('g1-c3', 'beforeTakeoff', 'bt-lights', 'Line 3: the lights are on. Press the framed line.'),
    lineStep('g1-c4', 'beforeTakeoff', 'bt-elec', 'Line 4: both generators are on. Press the framed line.'),
    lineStep('g1-c5', 'beforeTakeoff', 'bt-brief', 'Line 5: you have reviewed the wet runway and the storms. Press the framed line.'),
  ];

  const GUIDE_ES2 = [
    { id: 'g2-takeoff', where: W_COMMS, text: 'Tower clears you for takeoff. Press the framed reply. The aircraft then takes off by itself.', light: [litReply('twr-takeoff', 'to-readback')], doneWhen: replied({ messageId: 'twr-takeoff' }) },
    { id: 'g2-ap', where: W_AP, text: 'You are airborne. Press AP to switch the autopilot on.', light: [litControl('ap.engage', true)], doneWhen: st('ap.engaged', 'eq', true) },
    { id: 'g2-clb', where: W_AP, text: 'Press CLB so the aircraft climbs.', light: [litControl('ap.vertical', 'climb')], doneWhen: st('ap.vertical', 'eq', 'climb') },
    {
      id: 'g2-deviate',
      where: W_COMMS,
      text: 'Your decision: a storm is ahead on the weather display. Ask for a heading to the left or to the right.',
      waitText: 'Wait for Departure to call.',
      light: [litCard('dev-left'), litCard('dev-right')],
      doneWhen: any(replied({ cardId: 'dev-left' }), replied({ cardId: 'dev-right' })),
    },
    { id: 'g2-alt', where: W_AP, text: `Departure cleared you to ${climbText} feet. Press the framed button until ALT FT reads ${climbAltitude}.`, light: [litControl('ap.alt', climbAltitude)], doneWhen: between('ap.alt', climbAltitude - 100, climbAltitude + 100) },
    { id: 'g2-hdg-left', where: W_AP, text: 'Turn toward HDG 060 with the framed button. The next step appears once clear of the storm.', onlyWhen: replied({ cardId: 'dev-left' }), light: [litControl('ap.hdg', 60)], doneWhen: between('ap.hdg', 55, 65) },
    { id: 'g2-hdg-right', where: W_AP, text: 'Turn toward HDG 120 with the framed button. The next step appears once clear of the storm.', onlyWhen: replied({ cardId: 'dev-right' }), light: [litControl('ap.hdg', 120)], doneWhen: between('ap.hdg', 115, 125) },
  ];

  const GUIDE_ES3 = [
    { id: 'g3-handoff', where: W_COMMS, text: 'Departure hands you to the next controller. Press the framed reply.', light: [litReply('dep-handoff', 'ho-readback')], doneWhen: replied({ messageId: 'dep-handoff' }) },
    {
      id: 'g3-ack',
      where: W_ACK,
      text: `An alert has appeared: GEN ${failedGen} FAULT. Press ACK to acknowledge it.`,
      waitText: 'Keep climbing. An alert will appear on the right-hand display.',
      light: [{ kind: 'alertAck' as const, alertId: 'gen1-fail' }],
      doneWhen: { kind: 'action' as const, match: { kind: 'alertAck' as const, alertId: 'gen1-fail' } },
    },
    lineStep('g3-c1', 'genFail', 'gf-identify', `A fault checklist has opened. Line 1: the GEN ${failedGen} fault light is on overhead. Press the framed line.`),
    { id: 'g3-gen1', where: W_OVERHEAD, text: `Switch GEN ${failedGen} off. Leave GEN ${workingGen} alone: it is the only generator left.`, light: [litControl(`elec.${failedKey}`, false)], doneWhen: st(`elec.${failedKey}.switchOn`, 'eq', false) },
    lineStep('g3-c2', 'genFail', 'gf-gen1-off', `Line 2: GEN ${failedGen} is off. Press the framed line.`),
    { id: 'g3-bustie', where: W_OVERHEAD, text: 'Press BUS TIE twice: once to lift its guard, once to switch it on.', light: [litControl('elec.busTie', true)], doneWhen: st('elec.busTie', 'eq', true) },
    lineStep('g3-c3', 'genFail', 'gf-bustie', 'Line 3: the bus tie is on. Press the framed line.'),
    {
      id: 'g3-cabin',
      where: W_COMMS,
      text: 'The cabin crew is calling. Press the framed reply to tell them what is happening.',
      waitText: 'Wait for the cabin crew to call.',
      light: [litReply('cab-lights', 'cab-standby')],
      doneWhen: replied({ messageId: 'cab-lights' }),
    },
    lineStep('g3-c4', 'genFail', 'gf-cabin', 'Line 4: the cabin crew is advised. Press the framed line.'),
    {
      id: 'g3-center',
      where: W_COMMS,
      text: 'Center offers a higher level. Press the framed reply to report the failure instead.',
      waitText: 'Wait for Center to call.',
      light: [litReply('ctr-query', 'ctr-report')],
      doneWhen: replied({ messageId: 'ctr-query' }),
    },
    lineStep('g3-c5', 'genFail', 'gf-review', `Line 5: GEN ${workingGen} is now the only power source. Press the framed line.`),
  ];

  const routeStep = (id: string, cardId: string, airportId: string, airportName: string) => ({
    id,
    where: W_ROUTE,
    text: `Set the new destination. Press ${airportName}.`,
    onlyWhen: replied({ cardId }),
    light: [litControl('route.destination', airportId)],
    doneWhen: st('destination', 'eq', airportId),
  });
  // g4-confirm comes first so it takes over while dispatch waits for an answer to its concern.
  const GUIDE_ES4 = [
    {
      id: 'g4-confirm',
      where: W_COMMS,
      text: 'Dispatch questions the plan. Your decision: confirm it or reconsider.',
      onlyWhen: replied({ cardId: 'dec-continue' }),
      light: [litCard('confirm-continue'), litCard('reconsider')],
      doneWhen: any(replied({ cardId: 'confirm-continue' }), replied({ cardId: 'reconsider' })),
    },
    {
      id: 'g4-decide',
      where: W_COMMS,
      text: 'Your decision, captain. Read the dispatch options on the kneeboard to your left, then tell Center your plan.',
      waitText: 'Read the dispatch options on the kneeboard, to your left. Center will ask for your plan.',
      light: DECISION_CARDS.map((c) => litCard(c.id)),
      doneWhen: DECIDED,
    },
    routeStep('g4-route-return', 'dec-return', 'dep', DEP),
    routeStep('g4-route-alt1', 'dec-divert-alt1', 'alt1', ALT1),
    routeStep('g4-route-alt2', 'dec-divert-alt2', 'alt2', ALT2),
    { id: 'g4-pa', where: W_COMMS, text: 'Tell the passengers. Press the PA button.', light: [litControl('pa.cabin', true)], doneWhen: control('pa.cabin') },
    {
      id: 'g4-announce',
      where: W_COMMS,
      text: 'The PA is live. Press the framed announcement.',
      waitText: 'Stand by for the cabin crew.',
      light: [litReply('pa-cabin', 'pa-clear')],
      doneWhen: CABIN_INFORMED,
    },
  ];

  const scenario = {
    id: 'single-source',
    title: 'Single Source',
    notice: 'Generic fictional aircraft for scenario-management practice only. These are not real or approved procedures. Voices are computer-generated.',
    timeCompression: 6,
    latenessGraceSec: 10,
    initialAircraft: {
      altitudeFt: 0,
      headingDeg: 90,
      speedKt: 0,
      phase: 'holding',
      ap: { engaged: false, hdg: 0, alt: 0, lateral: 'hdg', vertical: 'hold' },
      baroHpa: 1009, // planning QNH; the updated ATIS in Event Set 1 gives the QNH of the chosen number set (1004, 1002 or 1006)
      lights: { landing: false, strobe: false },
      elec: {
        gen1: { switchOn: true, failed: false },
        gen2: { switchOn: true, failed: false },
        backupGenInop: true,
        busTie: false,
      },
      comFreq: '118.65',
      destination: 'dest',
      stormBearingDeg: null,
    },
    briefing: [
      {
        id: 'flight',
        title: 'Your flight',
        body: `${CALLSIGN}, ${DEP} to ${DEST}. About 5 hours, most of it over open water. You are the captain and you operate every control yourself. Your first officer calls out what they see and does not operate any control. The aircraft flies on autopilot: you manage it with the glareshield panel, the overhead panel, the pedestal and the reply cards.`,
      },
      {
        id: 'weather',
        title: 'Weather at planning',
        body: `${DEP}: wind 090 at 8 knots, light rain, runway 09 wet, QNH 1009. Thunderstorm cells in the area, drifting east. Updated weather will arrive before departure. ${DEST}: good weather expected.`,
      },
      {
        id: 'aircraft',
        title: 'Aircraft status',
        body: 'Generic twin-engine airliner. Two main generators, GEN 1 and GEN 2, both serviceable. Deferred item: BACKUP GENERATOR INOP, released under the minimum equipment list for this flight.',
      },
      {
        id: 'how',
        title: 'How it works',
        body: 'Poke switches, buttons and reply cards with a fingertip. New messages and their reply cards appear on the comms panel. Printouts arrive on this kneeboard. Need a hint? The hint button here points to where to look; hint use is noted in the debrief.',
      },
    ],
    airports: [
      { id: 'dep', name: DEP },
      { id: 'alt1', name: ALT1 },
      { id: 'alt2', name: ALT2 },
      { id: 'dest', name: DEST },
    ],
    checklists: [
      { id: 'beforeTakeoff', title: 'BEFORE TAKEOFF', items: BEFORE_TAKEOFF_ITEMS },
      { id: 'genFail', title: `GEN ${failedGen} FAULT`, items: GEN_FAIL_ITEMS },
    ],
    practice: { controlId: 'practice.toggle', prompt: 'Practice: poke the PRACTICE switch with your fingertip to turn it on.' },

    eventSets: [
      // ------------------------------------------------------------------------------------------
      {
        id: 'es1-before-takeoff',
        title: 'Before takeoff',
        phase: 'Holding short of runway 09',
        environment: 'Night, moderate rain, wet runway, thunderstorm cells to the east',
        distracters: [
          'Updated ATIS differs from the planning weather: lower QNH, gusty wind, lower cloud',
          'Tower hold-short instruction while the pilot is setting up',
        ],
        trigger: 'Updated ATIS and takeoff data arrive on the kneeboard',
        technical: 'Pre-flight setup: altimeter, autopilot targets, exterior lights, before-takeoff checklist',
        crm: 'Preparation and planning',
        objective:
          'Notices that the updated weather differs from the planning weather and sets the new QNH. Sets the autopilot heading and altitude from the takeoff data, switches on the exterior lights, reads back the hold-short instruction, and completes the before-takeoff checklist, confirming each item only once the matching control is set.',
        instructorNotes:
          `The planning QNH (1009) is already set; the updated ATIS gives ${qnh}. The point is to compare, not to tick. The altimeter item is trapped: confirming it while the old setting is still in is an error, corrected if the QNH is then set before the set ends. The set ends when the last checklist item is confirmed (or after 150 s), so a pilot who taps straight through carries every miss into the debrief. Gusts and the lower cloud base are background.`,
        startCues: [
          {
            kind: 'printout',
            id: 'atis-kilo',
            title: `Updated ATIS - information ${atis}`,
            body: `${DEP.toUpperCase()} INFORMATION ${atis.toUpperCase()}\nWind 110 at 14 knots, gusting 22\nVisibility 4 km in moderate rain\nCloud broken 1,200 ft, overcast 3,000 ft\nThunderstorms east and southeast, moving east\nTemperature 17, dew point 15\nQNH ${qnh}\nRunway 09 in use, surface wet`,
          },
          {
            kind: 'printout',
            id: 'takeoff-data',
            title: 'Takeoff data',
            body: `Runway 09, wet. Full takeoff thrust.\nSpeeds: V1 136, VR 140, V2 145\nAfter takeoff: heading 090, climb to ${firstText} ft\nAutopilot targets: HDG 090, ALT ${firstText}\nAltimeter: QNH from the latest ATIS`,
          },
          {
            kind: 'message',
            id: voiceId('twr-hold', numberTag),
            channel: 'atc',
            text: `${CALLSIGN}, Tower, hold short runway 09. Information ${atis} is now current. Expect departure in two minutes.`,
            cards: [
              { id: 'hold-readback', text: `Holding short runway 09, information ${atis}, ${CALLSIGN}.` },
              { id: 'hold-roger', text: `Roger, ${CALLSIGN}.` },
            ],
          },
          { kind: 'checklistAvailable', checklistId: 'beforeTakeoff' },
        ],
        rules: [
          {
            id: 'fo-es1-checklist',
            instructorLabel: 'Before takeoff checklist complete.',
            when: allTicked('beforeTakeoff', BEFORE_TAKEOFF_ITEMS.map((i) => i.id)),
            cues: [{ kind: 'message', id: 'fo-es1-checklist', channel: 'crew', text: 'Before takeoff checklist complete.' }],
          },
        ],
        endWhen: any(allTicked('beforeTakeoff', BEFORE_TAKEOFF_ITEMS.map((i) => i.id)), at(SET_FALLBACK_SEC)),
        checks: [
          {
            kind: 'comm',
            id: 'es1-hold-readback',
            messageId: voiceId('twr-hold', numberTag),
            quality: { 'hold-readback': 'good', 'hold-roger': 'poor' },
            category: 'crm',
            reason: 'The hold-short instruction was not read back in full.',
          },
          {
            kind: 'required',
            id: 'es1-qnh',
            when: st('baroHpa', 'eq', qnh),
            category: 'procedures',
            reason: `The altimeter was not set to the updated QNH (${qnh}) from the latest ATIS.`,
          },
          {
            kind: 'errorTrap',
            id: 'es1-qnh-confirmed-early',
            when: all(ticked('beforeTakeoff', 'bt-altimeter'), st('baroHpa', 'neq', qnh)),
            trappedWhen: st('baroHpa', 'eq', qnh),
            severity: 'minor',
            category: 'procedures',
            reason: 'The altimeter checklist item was confirmed before the altimeter was actually set.',
          },
          {
            kind: 'required',
            id: 'es1-ap-targets',
            when: all(st('ap.hdg', 'gte', 85), st('ap.hdg', 'lte', 95), st('ap.alt', 'gte', firstAltitude - 100), st('ap.alt', 'lte', firstAltitude + 100)),
            category: 'automation',
            reason: `The autopilot heading and altitude were not set to the takeoff data (HDG 090, ALT ${firstText}).`,
          },
          {
            kind: 'required',
            id: 'es1-lights',
            when: all(st('lights.landing', 'eq', true), st('lights.strobe', 'eq', true)),
            category: 'procedures',
            reason: 'The landing and strobe lights were not on for takeoff.',
          },
        ],
        hints: [
          'Compare the updated ATIS and takeoff data on your kneeboard with the settings on the glareshield panel.',
          'The before-takeoff checklist is on the pedestal display. Each line names the panel to check.',
        ],
        guide: GUIDE_ES1,
      },

      // ------------------------------------------------------------------------------------------
      {
        id: 'es2-takeoff-climb',
        title: 'Takeoff and climb',
        phase: 'Takeoff and initial climb',
        environment: 'Moderate rain, in cloud after takeoff, a strong convective cell ahead near the departure heading',
        distracters: [
          'Storm cell on the weather display, just right of the departure heading',
          'Departure climb and heading instruction arrives while the autopilot is being set up',
        ],
        trigger: 'Takeoff clearance from Tower',
        technical: 'Autopilot modes: engage, set the cleared altitude, climb, select a deviation heading',
        crm: 'Situational awareness',
        objective:
          'Reads back the takeoff clearance. After takeoff, engages the autopilot, sets the cleared altitude and the climb mode, and recognizes the storm cell on the weather display. Asks ATC for a deviation when the climb clearance comes (left or right are equally good), then flies the approved heading.',
        instructorNotes:
          `The storm sits about 5 degrees right of the departure heading. Left (heading 060) and right (heading 120) are equally valid. If the pilot only reads back the climb clearance (no deviation request) and is still on heading 090 25 s later, Departure raises the weather; the deviation then counts as a corrected (trapped) minor error. Nothing climbs or turns until the pilot engages the autopilot and selects climb, so watch for a pilot who waits; the hint points at the autopilot panel. The set ends at 6,000 ft once the aircraft is clear of the cell, so generator ${failedGen} fails in the next set while still climbing; it also ends after 150 s regardless.`,
        startCues: [
          { kind: 'aircraft', patch: { stormBearingDeg: 95 } },
          {
            kind: 'message',
            id: 'twr-takeoff',
            channel: 'atc',
            text: `${CALLSIGN}, wind 110 at 14, gusting 22, runway 09, cleared for takeoff.`,
            cards: [
              { id: 'to-readback', text: `Runway 09, cleared for takeoff, ${CALLSIGN}.` },
              { id: 'to-roger', text: `Roger, ${CALLSIGN}.` },
            ],
          },
        ],
        rules: [
          {
            id: 'es2-takeoff',
            instructorLabel: 'Takeoff: the aircraft rolls and is hand-flown to 800 ft once the clearance is answered',
            when: replied({ messageId: 'twr-takeoff' }),
            cues: [{ kind: 'aircraft', patch: { phase: 'takeoff', speedKt: 170, altitudeFt: 800 } }],
            physical: true,
          },
          {
            id: 'es2-departure',
            instructorLabel: `Departure: radar contact, climb ${climbText} ft, heading 090 (6 s after takeoff)`,
            when: fired('es2-takeoff', 6),
            cues: [
              {
                kind: 'message',
                id: voiceId('dep-climb', numberTag),
                channel: 'atc',
                text: `${CALLSIGN}, Departure, radar contact. Climb and maintain ${climbText} feet. Fly heading 090.`,
                cards: [
                  { id: 'dep-readback', text: `Climb ${climbText} feet, heading 090, ${CALLSIGN}.` },
                  { id: 'dev-left', text: `Climb ${climbText} feet. Request heading 060 for weather, ${CALLSIGN}.` },
                  { id: 'dev-right', text: `Climb ${climbText} feet. Request heading 120 for weather, ${CALLSIGN}.` },
                ],
              },
            ],
          },
          {
            id: 'es2-dev-left-ok',
            instructorLabel: 'Approve the left deviation (heading 060)',
            when: replied({ messageId: voiceId('dep-climb', numberTag), cardId: 'dev-left' }),
            cues: [
              {
                kind: 'message',
                id: voiceId('dep-dev-left', numberTag),
                channel: 'atc',
                text: `${CALLSIGN}, heading 060 approved. Advise clear of weather. Climb and maintain ${climbText} feet.`,
              },
            ],
          },
          {
            id: 'es2-dev-right-ok',
            instructorLabel: 'Approve the right deviation (heading 120)',
            when: replied({ messageId: voiceId('dep-climb', numberTag), cardId: 'dev-right' }),
            cues: [
              {
                kind: 'message',
                id: voiceId('dep-dev-right', numberTag),
                channel: 'atc',
                text: `${CALLSIGN}, heading 120 approved. Advise clear of weather. Climb and maintain ${climbText} feet.`,
              },
            ],
          },
          {
            id: 'es2-wx-advice',
            instructorLabel: 'Plain readback only, still on heading 080-100 25 s after the climb clearance: Departure points out the weather',
            when: all(replied({ messageId: voiceId('dep-climb', numberTag), cardId: 'dep-readback' }), fired('es2-departure', 25), ON_STORM_HEADING),
            cues: [
              {
                kind: 'message',
                id: 'atc-wx',
                channel: 'atc',
                text: `${CALLSIGN}, Departure. I show heavy weather 10 miles ahead on your heading. Deviation left or right approved. Say direction.`,
                cards: [
                  { id: 'dev-left', text: `Left, heading 060, ${CALLSIGN}.` },
                  { id: 'dev-right', text: `Right, heading 120, ${CALLSIGN}.` },
                ],
              },
            ],
          },

          {
            id: 'fo-es2-airborne',
            instructorLabel: 'Positive climb.',
            when: fired('es2-takeoff', 2),
            cues: [{ kind: 'message', id: 'fo-es2-airborne', channel: 'crew', text: 'Positive climb.' }],
          },
          {
            id: 'fo-es2-ap',
            instructorLabel: 'Autopilot engaged.',
            when: all(fired('es2-takeoff'), st('ap.engaged', 'eq', true)),
            cues: [{ kind: 'message', id: 'fo-es2-ap', channel: 'crew', text: 'Autopilot engaged.' }],
          },
          {
            id: 'fo-es2-clear',
            instructorLabel: 'We are clear of the weather.',
            when: all(fired('es2-takeoff'), CLEAR_OF_STORM),
            cues: [{ kind: 'message', id: 'fo-es2-clear', channel: 'crew', text: 'We are clear of the weather.' }],
          },
        ],
        endWhen: any(all(st('altitudeFt', 'gte', 6000), CLEAR_OF_STORM), at(SET_FALLBACK_SEC)),
        checks: [
          {
            kind: 'comm',
            id: 'es2-takeoff-readback',
            messageId: 'twr-takeoff',
            quality: { 'to-readback': 'good', 'to-roger': 'poor' },
            category: 'crm',
            reason: 'The takeoff clearance was not read back with the runway.',
          },
          {
            kind: 'comm',
            id: 'es2-climb-readback',
            messageId: voiceId('dep-climb', numberTag),
            quality: { 'dep-readback': 'acceptable', 'dev-left': 'good', 'dev-right': 'good' },
            category: 'crm',
            reason: 'The climb clearance from Departure was not answered.',
          },
          {
            kind: 'errorTrap',
            id: 'es2-storm-late',
            when: replied({ messageId: voiceId('dep-climb', numberTag), cardId: 'dep-readback' }),
            trappedWhen: CLEAR_OF_STORM,
            severity: 'minor',
            category: 'crm',
            reason: 'The storm cell ahead on the weather display was not raised with ATC until ATC pointed it out.',
          },
          {
            kind: 'required',
            id: 'es2-ap-engaged',
            when: st('ap.engaged', 'eq', true),
            withinSec: 60,
            category: 'automation',
            reason: 'The autopilot was not engaged promptly after takeoff.',
          },
          {
            kind: 'required',
            id: 'es2-cleared-alt',
            when: all(st('ap.alt', 'gte', climbAltitude - 100), st('ap.alt', 'lte', climbAltitude + 100)),
            category: 'automation',
            reason: `The cleared altitude (${climbText} ft) was not set on the autopilot.`,
          },
          {
            kind: 'required',
            id: 'es2-clear-of-storm',
            when: CLEAR_OF_STORM,
            category: 'handling',
            reason: 'The aircraft was not turned clear of the storm cell.',
          },
        ],
        hints: [
          'Compare the weather display with the latest ATC message on the comms panel.',
          'Check the autopilot panel on the glareshield: the aircraft climbs and turns only through the autopilot.',
        ],
        guide: GUIDE_ES2,
      },

      // ------------------------------------------------------------------------------------------
      {
        id: 'es3-gen-failure',
        title: 'Generator failure',
        phase: 'Climb through 10,000 ft',
        environment: 'In cloud, light turbulence, deviating around weather',
        distracters: [
          'Frequency change to Center',
          'Cabin crew call about flickering lights and galley power',
          'Center offers a higher level',
        ],
        trigger: `GEN ${failedGen} FAULT caution while climbing through 10,000 ft`,
        technical: 'Abnormal procedure: alert, electronic checklist, overhead electrical switches',
        crm: 'Workload management',
        objective:
          `Reads back the frequency change. Acknowledges the GEN ${failedGen} FAULT caution and runs the electronic checklist, operating only the overhead switches it calls for (GEN ${failedGen} off, bus tie on). Gives the cabin crew a clear picture and tells ATC about the failure rather than accepting a further climb without comment.`,
        instructorNotes:
          `GEN ${failedGen} fails climbing through 10,000 ft (fallback: 50 s into the set if the pilot levelled off lower). GEN ${workingGen} keeps working; with the backup generator already deferred, the aircraft is now on a single source. Error traps: GEN ${failedGen} switched back on (no reset in this checklist; corrected if switched off again), and GEN ${workingGen} switched off (removes the only working generator; GEN ${workingGen} OFF caution plus a NO MAIN GENERATOR warning until it is back on; corrected only if back on within 20 s). The cabin call comes 10 s after the failure; Center offers a higher level once the cabin call is answered. The set ends when the checklist is complete and both calls are answered, or after 150 s.`,
        startCues: [
          {
            kind: 'message',
            id: 'dep-handoff',
            channel: 'atc',
            text: `${CALLSIGN}, contact Center on ${CENTER_FREQ}. Good day.`,
            cards: [
              { id: 'ho-readback', text: `${CENTER_FREQ}, ${CALLSIGN}, good day.` },
              { id: 'ho-roger', text: 'Roger, good day.' },
            ],
          },
        ],
        rules: [
          {
            id: 'es3-center-checkin',
            instructorLabel: 'Pilot answered the handoff: Center radar contact',
            when: replied({ messageId: 'dep-handoff' }),
            cues: [
              { kind: 'aircraft', patch: { comFreq: CENTER_FREQ } },
              {
                kind: 'message',
                id: voiceId('ctr-checkin', numberTag),
                channel: 'atc',
                text: `${CALLSIGN}, Center, radar contact. Continue your deviation, climb and maintain ${climbText} feet.`,
              },
            ],
          },
          {
            id: 'es3-gen-fail',
            instructorLabel: `FAIL GEN ${failedGen} (climbing through 10,000 ft, or 50 s into the set)`,
            when: any(st('altitudeFt', 'gte', 10000), at(50)),
            cues: [
              { kind: 'aircraft', patch: { elec: { [failedKey]: { failed: true } } } },
              { kind: 'alert', id: 'gen1-fail', level: 'caution', text: `GEN ${failedGen} FAULT` },
            ],
          },
          {
            id: 'es3-checklist',
            instructorLabel: `Alert acknowledged: GEN ${failedGen} FAULT checklist opens on the pedestal`,
            when: { kind: 'action', match: { kind: 'alertAck', alertId: 'gen1-fail' } },
            cues: [{ kind: 'checklistAvailable', checklistId: 'genFail' }],
            physical: true,
          },
          {
            id: 'es3-gen2-off-caution',
            instructorLabel: `GEN ${workingGen} switched off: GEN ${workingGen} OFF caution`,
            when: st(`elec.${workingKey}.switchOn`, 'eq', false),
            cues: [{ kind: 'alert', id: 'gen2-off', level: 'caution', text: `GEN ${workingGen} OFF` }],
            physical: true,
          },
          {
            id: 'es3-gen2-on-clear',
            instructorLabel: `GEN ${workingGen} back on: clear the GEN ${workingGen} OFF caution`,
            when: all(fired('es3-gen2-off-caution'), st(`elec.${workingKey}.switchOn`, 'eq', true)),
            cues: [{ kind: 'alertClear', id: 'gen2-off' }],
            physical: true,
          },
          {
            id: 'es3-no-gen-warning',
            instructorLabel: 'No main generator online: NO MAIN GENERATOR warning',
            when: all(st(`elec.${workingKey}.switchOn`, 'eq', false), any(st(`elec.${failedKey}.failed`, 'eq', true), st(`elec.${failedKey}.switchOn`, 'eq', false))),
            cues: [{ kind: 'alert', id: 'elec-no-gen', level: 'warning', text: 'NO MAIN GENERATOR' }],
            physical: true,
          },
          {
            id: 'es3-no-gen-clear',
            instructorLabel: `GEN ${workingGen} back on: clear the NO MAIN GENERATOR warning`,
            when: all(fired('es3-no-gen-warning'), st(`elec.${workingKey}.switchOn`, 'eq', true)),
            cues: [{ kind: 'alertClear', id: 'elec-no-gen' }],
            physical: true,
          },
          {
            id: 'es3-cabin-call',
            instructorLabel: 'Cabin call: flickering lights, galley off (10 s after the failure)',
            when: fired('es3-gen-fail', 10),
            cues: [
              {
                kind: 'message',
                id: 'cab-lights',
                channel: 'cabin',
                text: 'Captain, cabin. The lights in the forward cabin flickered and the galley ovens just went off. Is everything all right?',
                cards: [
                  { id: 'cab-standby', text: 'We have an electrical fault and are working on it. Please switch off galley power and stand by for a brief.' },
                  { id: 'cab-later', text: 'Busy right now, call back later.' },
                  { id: 'cab-fine', text: 'Everything is fine, carry on with the service.' },
                ],
              },
            ],
          },
          {
            id: 'es3-center-offer',
            instructorLabel: 'Cabin answered: Center offers a higher level',
            when: replied({ messageId: 'cab-lights' }),
            cues: [
              {
                kind: 'message',
                id: 'ctr-query',
                channel: 'atc',
                text: `${CALLSIGN}, Center. Flight level 240 is available now. Advise ready for higher.`,
                cards: [
                  { id: 'ctr-report', text: `Unable higher for now. We have a generator failure and are running the checklist, ${CALLSIGN}.` },
                  { id: 'ctr-accept', text: `Ready for higher, ${CALLSIGN}.` },
                ],
              },
            ],
          },
          {
            id: 'es3-center-ack-report',
            instructorLabel: 'Center acknowledges the reported failure',
            when: replied({ messageId: 'ctr-query', cardId: 'ctr-report' }),
            cues: [
              { kind: 'message', id: voiceId('ctr-ack-report', numberTag), channel: 'atc', text: `${CALLSIGN}, roger. Maintain ${climbText} feet and advise intentions when able.` },
            ],
          },
          {
            id: 'es3-center-climb',
            instructorLabel: 'Pilot accepted higher: Center clears flight level 240',
            when: replied({ messageId: 'ctr-query', cardId: 'ctr-accept' }),
            cues: [{ kind: 'message', id: 'ctr-climb', channel: 'atc', text: `${CALLSIGN}, climb and maintain flight level 240.` }],
          },

          {
            id: 'fo-es3-fault',
            instructorLabel: `Caution, GEN ${failedGen} FAULT.`,
            when: fired('es3-gen-fail', 1),
            cues: [{ kind: 'message', id: voiceId('fo-es3-fault', genTag), channel: 'crew', text: `Caution, GEN ${failedGen} FAULT.` }],
          },
          {
            id: 'fo-es3-checklist',
            instructorLabel: `GEN ${failedGen} FAULT checklist is open.`,
            when: fired('es3-checklist'),
            cues: [{ kind: 'message', id: voiceId('fo-es3-checklist', genTag), channel: 'crew', text: `GEN ${failedGen} FAULT checklist is open.` }],
          },
          {
            id: 'fo-es3-gen1-off',
            instructorLabel: `GEN ${failedGen} is off.`,
            when: all(fired('es3-gen-fail'), st(`elec.${failedKey}.switchOn`, 'eq', false)),
            cues: [{ kind: 'message', id: voiceId('fo-es3-gen1-off', genTag), channel: 'crew', text: `GEN ${failedGen} is off.` }],
          },
          {
            id: 'fo-es3-bustie',
            instructorLabel: `Bus tie is on. GEN ${workingGen} is powering both buses.`,
            when: all(fired('es3-gen-fail'), st('elec.busTie', 'eq', true), st(`elec.${workingKey}.switchOn`, 'eq', true)), // only true when the working generator really is on (integrator fix)
            cues: [{ kind: 'message', id: voiceId('fo-es3-bustie', genTag), channel: 'crew', text: `Bus tie is on. GEN ${workingGen} is powering both buses.` }],
          },
          {
            id: 'fo-es3-complete',
            instructorLabel: `GEN ${failedGen} FAULT checklist complete.`,
            when: allTicked('genFail', GEN_FAIL_ITEMS.map((i) => i.id)),
            cues: [{ kind: 'message', id: voiceId('fo-es3-complete', genTag), channel: 'crew', text: `GEN ${failedGen} FAULT checklist complete.` }],
          },
        ],
        endWhen: any(
          all(allTicked('genFail', GEN_FAIL_ITEMS.map((i) => i.id)), replied({ messageId: 'cab-lights' }), replied({ messageId: 'ctr-query' })),
          at(SET_FALLBACK_SEC),
        ),
        checks: [
          {
            kind: 'comm',
            id: 'es3-handoff-readback',
            messageId: 'dep-handoff',
            quality: { 'ho-readback': 'good', 'ho-roger': 'poor' },
            category: 'crm',
            reason: 'The new Center frequency was not read back.',
          },
          {
            kind: 'required',
            id: 'es3-alert-ack',
            when: { kind: 'action', match: { kind: 'alertAck', alertId: 'gen1-fail' } },
            category: 'procedures',
            reason: `The GEN ${failedGen} FAULT caution was not acknowledged.`,
          },
          {
            kind: 'required',
            id: 'es3-checklist-done',
            when: allTicked('genFail', GEN_FAIL_ITEMS.map((i) => i.id)),
            category: 'procedures',
            reason: `The GEN ${failedGen} FAULT checklist was not completed.`,
          },
          {
            kind: 'required',
            id: 'es3-gen1-off',
            when: st(`elec.${failedKey}.switchOn`, 'eq', false),
            category: 'systems',
            reason: `GEN ${failedGen} was not switched off as the checklist requires.`,
          },
          {
            kind: 'required',
            id: 'es3-bus-tie',
            when: st('elec.busTie', 'eq', true),
            category: 'systems',
            reason: `The bus tie was not switched on, so GEN ${workingGen} was not powering both electrical buses.`,
          },
          {
            kind: 'errorTrap',
            id: 'es3-gen1-reset',
            when: all(control(`elec.${failedKey}`, false), control(`elec.${failedKey}`, true)),
            trappedWhen: st(`elec.${failedKey}.switchOn`, 'eq', false),
            severity: 'minor',
            category: 'procedures',
            reason: `GEN ${failedGen} was switched off and on again; this checklist does not call for a reset.`,
          },
          {
            kind: 'errorTrap',
            id: 'es3-gen2-off',
            when: control(`elec.${workingKey}`, false),
            trappedWhen: st(`elec.${workingKey}.switchOn`, 'eq', true),
            trapWithinSec: 20,
            severity: 'major',
            category: 'systems',
            reason: `GEN ${workingGen}, the only working generator, was switched off.`,
          },
          {
            kind: 'comm',
            id: 'es3-cabin-reply',
            messageId: 'cab-lights',
            quality: { 'cab-standby': 'good', 'cab-later': 'acceptable', 'cab-fine': 'poor' },
            category: 'crm',
            reason: "The cabin crew's report was not answered with a clear picture of the fault.",
          },
          {
            kind: 'comm',
            id: 'es3-atc-report',
            messageId: 'ctr-query',
            quality: { 'ctr-report': 'good', 'ctr-accept': 'poor' },
            category: 'crm',
            reason: 'ATC was not told about the generator failure when it offered a higher level.',
          },
        ],
        hints: [
          'Look at the alert display and the electronic checklist on the pedestal.',
          'The switches the checklist names are on the overhead electrical panel. Calls wait on the comms panel.',
        ],
        guide: GUIDE_ES3,
      },

      // ------------------------------------------------------------------------------------------
      {
        id: 'es4-decision',
        title: 'Decision',
        phase: `Level at ${climbText} ft before the oceanic crossing`,
        environment: 'Single generator, backup generator deferred, about 4.5 hours of open water ahead',
        distracters: [
          'Dispatch message with the options for each airport',
          'Two alternates with different trade-offs',
          'Center wants intentions before the oceanic boundary',
        ],
        trigger: 'Dispatch message about the generator fault, then Center asks for intentions',
        technical: 'Route setup on the route panel; PA to the cabin',
        crm: 'Decision making and communication',
        objective:
          'Recognizes that one more failure would leave no main generator over open water, weighs the options and commits to a return or a diversion to a suitable airport. Tells ATC, sets the new destination on the route panel, and gives the cabin a calm, clear announcement.',
        instructorNotes: `Acceptable: return to ${DEP} (known airport, company maintenance, storms moving away, but a wet runway) or divert to ${goodName} (closest good-weather airport, long dry runway, no company maintenance); discuss either trade-off in the debrief. ${weakName} is farther out over water with a short runway and fog forming: graded down (minor, not corrected). Continue: dispatch sends one concern message; reconsidering and then returning or diverting is a corrected major error; confirming continue is a safety-of-flight issue and grades the set 1. No extra failure is ever added. The PA cards appear only after a decision is committed; each dispatch acknowledgement ends with a one-line reminder to brief the cabin. Center asks again at 120 s only if no decision has been committed by then. The set times out at 180 s.`,
        startCues: [
          { kind: 'aircraft', patch: { stormBearingDeg: null } },
          {
            kind: 'printout',
            id: 'dsp-options',
            title: 'Dispatch - options',
            body: `For the captain's decision. Distances from present position.\n${DEP.toUpperCase()} (departure): 60 nm behind. Runway 2,800 m, wet. Storms moving east, away from the field. Company maintenance base.\n${ALT1.toUpperCase()}: ${goodAlternate === 'alt1' ? goodProfile : weakProfile}\n${ALT2.toUpperCase()}: ${goodAlternate === 'alt2' ? goodProfile : weakProfile}\n${DEST.toUpperCase()} (destination): 1,450 nm ahead, about 4.5 hours, mostly over open water. Good weather.`,
          },
          {
            kind: 'message',
            id: voiceId('dsp-fault', genTag),
            channel: 'dispatch',
            text: `${CALLSIGN}, dispatch. We received your GEN ${failedGen} fault message. Options for each airport are on your kneeboard. Your decision, captain; we will support it.`,
          },
        ],
        rules: [
          {
            id: 'es4-center-asks',
            instructorLabel: 'Center asks for intentions (8 s into the set)',
            when: at(8),
            cues: [
              {
                kind: 'message',
                id: 'ctr-intentions',
                channel: 'atc',
                text: `${CALLSIGN}, Center. You are 20 minutes from the oceanic boundary. Advise intentions.`,
                cards: DECISION_CARDS,
              },
            ],
          },
          ackRule('es4-ack-return', 'dec-return', DEP, 'Advise ready for descent.', `Dispatch copies your return to ${DEP}. Maintenance will meet the aircraft.`),
          ackRule('es4-ack-alt1', 'dec-divert-alt1', ALT1, goodAlternate === 'alt1' ? 'Advise ready for descent.' : `${ALT1} reports fog, visibility 800 meters.`, `Dispatch copies your diversion to ${ALT1}.${goodAlternate === 'alt1' ? ' Ground handling is arranged.' : ''}`),
          ackRule('es4-ack-alt2', 'dec-divert-alt2', ALT2, goodAlternate === 'alt2' ? 'Advise ready for descent.' : `${ALT2} reports fog, visibility 800 meters.`, `Dispatch copies your diversion to ${ALT2}.${goodAlternate === 'alt2' ? ' Ground handling is arranged.' : ''}`),
          {
            id: 'es4-concern',
            instructorLabel: 'Pilot chose continue: dispatch raises the redundancy concern (once)',
            when: replied({ cardId: 'dec-continue' }),
            cues: [
              {
                kind: 'message',
                id: 'dsp-concern',
                channel: 'dispatch',
                text: `Captain, dispatch. Before you continue: you are down to one generator and the backup is deferred. The next 4.5 hours are over open water, far from any airport. Please confirm your intentions.`,
                cards: [
                  { id: 'confirm-continue', text: `Confirmed. We continue to ${DEST}.` },
                  { id: 'reconsider', text: 'Understood. We will reconsider.' },
                ],
              },
            ],
          },
          {
            id: 'es4-ack-continue',
            instructorLabel: 'Continue confirmed: Center acknowledges; dispatch copies',
            when: replied({ cardId: 'confirm-continue' }),
            cues: [
              { kind: 'message', id: 'ctr-ack-continue', channel: 'atc', text: `${CALLSIGN}, roger. Proceed on course to ${DEST}. Report at the oceanic boundary.` },
              { kind: 'message', id: 'dsp-ack-continue', channel: 'dispatch', text: `Dispatch copies: continuing to ${DEST}. ${COACH_CABIN}` },
            ],
          },
          {
            id: 'es4-reconsider',
            instructorLabel: 'Pilot will reconsider: dispatch re-offers return or diversion',
            when: replied({ cardId: 'reconsider' }),
            cues: [
              {
                kind: 'message',
                id: 'dsp-reoffer',
                channel: 'dispatch',
                text: 'Copy, captain. Tell us your new plan and we will pass it to Center.',
                cards: [
                  { id: 'dec-return', text: `New plan: return to ${DEP}.` },
                  { id: 'dec-divert-alt1', text: `New plan: divert to ${ALT1}.` },
                  { id: 'dec-divert-alt2', text: `New plan: divert to ${ALT2}.` },
                ],
              },
            ],
          },
          {
            id: 'es4-pa',
            instructorLabel: 'PA pressed after a committed decision: cabin and PA cards',
            when: all(control('pa.cabin', true), DECIDED),
            cues: [{ kind: 'message', id: 'pa-cabin', channel: 'cabin', text: 'Cabin crew standing by. The PA is live: choose your announcement.', cards: PA_CARDS }],
          },

          {
            id: 'fo-es4-route',
            instructorLabel: 'New destination is set.',
            when: destIs('dep', 'alt1', 'alt2'),
            cues: [{ kind: 'message', id: 'fo-es4-route', channel: 'crew', text: 'New destination is set.' }],
          },
          {
            id: 'fo-es4-cabin',
            instructorLabel: 'The cabin has been briefed.',
            when: CABIN_INFORMED,
            cues: [{ kind: 'message', id: 'fo-es4-cabin', channel: 'crew', text: 'The cabin has been briefed.' }],
          },
        ],
        endWhen: any(DIVERSION_SET_UP, CONTINUE_CONFIRMED),
        checks: [
          {
            kind: 'required',
            id: 'es4-decision-made',
            when: DECIDED,
            withinSec: 110,
            category: 'crm',
            reason: 'Decision not made in time.',
          },
          {
            kind: 'safety',
            id: 'es4-continue-safety',
            when: replied({ cardId: 'confirm-continue' }),
            category: 'crm',
            reason:
              'Continuing over open water on one generator, with the backup already deferred, meant one more failure would leave no main generator hours from any airport. That is a safety-of-flight issue.',
          },
          {
            kind: 'errorTrap',
            id: 'es4-continue-first',
            when: replied({ cardId: 'dec-continue' }),
            trappedWhen: destIs('dep', goodAlternate),
            severity: 'major',
            category: 'crm',
            reason: 'Continuing over open water with no generator redundancy was the first plan given to ATC.',
          },
          {
            kind: 'errorTrap',
            id: 'es4-weak-alternate',
            when: any(st('destination', 'eq', weakAlternate), replied({ cardId: `dec-divert-${weakAlternate}` })),
            trappedWhen: destIs('dep', goodAlternate),
            severity: 'minor',
            category: 'crm',
            reason: `${weakName} was chosen: farther out over water, with a short runway and fog forming, it was the weakest option for a degraded aircraft.`,
          },
          {
            kind: 'required',
            id: 'es4-route-set',
            when: any(destIs('dep', 'alt1', 'alt2'), replied({ cardId: 'confirm-continue' })),
            category: 'automation',
            reason: 'The new destination was not set on the route panel.',
          },
          {
            kind: 'required',
            id: 'es4-cabin-informed',
            when: CABIN_INFORMED,
            category: 'crm',
            reason: 'The cabin was not told about the situation and the plan.',
          },
          {
            kind: 'comm',
            id: 'es4-pa-quality',
            messageId: 'pa-cabin',
            quality: { 'pa-clear': 'good', 'pa-short': 'acceptable', 'pa-vague': 'poor', 'pa-alarm': 'poor' },
            category: 'crm',
            reason: 'The announcement did not give the cabin a calm, clear picture of the situation and the plan.',
          },
        ],
        hints: [
          'Read the dispatch options printout on your kneeboard.',
          'Plans are set up with the comms panel, the route panel and the PA button on the pedestal.',
        ],
        guide: GUIDE_ES4,
      },
    ],

    endConditions: [
      { reason: 'diversionSetUp', when: DIVERSION_SET_UP },
      { reason: 'continueConfirmed', when: CONTINUE_CONFIRMED },
    ],
    softTimeout: {
      eventSetId: 'es4-decision',
      promptAtSec: 120,
      afterSec: 180,
      promptCue: {
        kind: 'message',
        id: 'ctr-say-intentions',
        channel: 'atc',
        text: `${CALLSIGN}, Center. Oceanic boundary in 10 minutes. Confirm your intentions.`,
        cards: DECISION_CARDS,
      },
      // Once a decision is committed, ATC already has the pilot's intentions: do not ask again.
      skipPromptWhen: DECIDED,
    },
  };

  const result = parseScenario(withVoice(scenario, VOICED_MESSAGE_IDS));
  memo.set(index, result);
  return result;
}

export const singleSource: Scenario = buildSingleSource(0);
export default singleSource;
