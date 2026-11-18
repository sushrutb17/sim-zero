#!/usr/bin/env node
// Writes docs/review/<flight-id>-review.md: one plain-English baseline review per flight for the
// pilot plausibility review. No new dependencies: Vite (already installed) loads the TypeScript
// scenario module through its SSR loader, which handles extensionless imports.
// Usage (from app/): npm run export:review
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const reviewDir = join(appDir, '..', 'docs', 'review');
const PILOT_VALIDATION = 'INVENTED - to be validated by the user (a pilot)';

const CATEGORY = { crm: 'Communication & CRM', automation: 'Automation', handling: 'Aircraft handling', procedures: 'Procedures', systems: 'Systems knowledge' };
const CHANNEL = { atc: 'ATC', cabin: 'Cabin', dispatch: 'Dispatch', ground: 'Ground', crew: 'F/O' };
const OP = { eq: '=', neq: '!=', gte: '>=', lte: '<=' };

/** Review markers by cue id: invented data and coaching lines the pilot reviewers should check. */
const MARKS = {
  'atis-kilo': 'INVENTED - VERIFY (all ATIS values)',
  'takeoff-data': 'INVENTED - VERIFY (V-speeds, thrust, initial altitude)',
  'dsp-options': 'INVENTED - VERIFY (distances, runway lengths, weather)',
  'dsp-ack-return': 'COACHING - VERIFY ("Recommend you brief the cabin.")',
  'dsp-ack-alt1': 'COACHING - VERIFY ("Recommend you brief the cabin.")',
  'dsp-ack-alt2': 'COACHING - VERIFY ("Recommend you brief the cabin.")',
  'dsp-ack-continue': 'COACHING - VERIFY ("Recommend you brief the cabin.")',
};
const mark = (id) => id.startsWith('tc-') || id.startsWith('cc-') ? ` **${PILOT_VALIDATION}**` : id.startsWith('fo-') ? ' **INVENTED - VERIFY**' : (MARKS[id] ? ` **${MARKS[id]}**` : '');

function makeRenderer(sc) {
  const airport = new Map(sc.airports.map((a) => [a.id, a.name]));
  const val = (path, v) => (path === 'destination' && airport.has(v) ? `${v} (${airport.get(v)})` : JSON.stringify(v));

  const cond = (c) => {
    switch (c.kind) {
      case 'atSec':
        return `${c.sec} s into the set`;
      case 'state':
        return `\`${c.path}\` ${OP[c.op]} ${val(c.path, c.value)}`;
      case 'ruleFired':
        return c.afterSec === undefined ? `rule \`${c.ruleId}\` has fired` : `${c.afterSec} s after rule \`${c.ruleId}\` fired`;
      case 'all':
        return c.of.length === 1 ? cond(c.of[0]) : `ALL of (${c.of.map(cond).join('; ')})`;
      case 'any':
        return c.of.length === 1 ? cond(c.of[0]) : `ANY of (${c.of.map(cond).join('; ')})`;
      case 'action': {
        const m = c.match;
        if (m.kind === 'reply')
          return `pilot taps ${m.cardId ? `card \`${m.cardId}\`` : 'any card'}${m.messageId ? ` on message \`${m.messageId}\`` : ''}`;
        if (m.kind === 'control') return `pilot sets \`${m.controlId ?? 'any control'}\`${m.value === undefined ? '' : ` to ${JSON.stringify(m.value)}`}`;
        if (m.kind === 'checklistItem') return `pilot confirms checklist item \`${m.itemId ?? 'any'}\``;
        if (m.kind === 'alertAck') return `pilot acknowledges alert \`${m.alertId ?? 'any'}\``;
        if (m.kind === 'hint') return 'pilot uses a hint';
        return JSON.stringify(m);
      }
      default:
        return JSON.stringify(c);
    }
  };

  const quote = (s) => s.split('\n').map((l) => `> ${l}`).join('\n');
  const cue = (c) => {
    switch (c.kind) {
      case 'message': {
        const head = `- **${CHANNEL[c.channel]} message** \`${c.id}\`: "${c.text}"${mark(c.id)}`;
        const cards = (c.cards ?? []).map((k) => `  - reply card \`${k.id}\`: "${k.text}"`);
        return [head, ...cards].join('\n');
      }
      case 'printout':
        return `- **Kneeboard printout** \`${c.id}\` - ${c.title}${mark(c.id)}\n\n${quote(c.body)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')}\n`;
      case 'alert':
        return `- **Alert** \`${c.id}\` (${c.level}): "${c.text}"`;
      case 'alertClear':
        return `- Alert \`${c.id}\` clears`;
      case 'checklistAvailable':
        return `- Checklist \`${c.checklistId}\` opens on the pedestal`;
      case 'aircraft':
        return `- Aircraft change (not shown as text): \`${JSON.stringify(c.patch)}\``;
      default:
        return `- ${c.kind}`;
    }
  };

  const check = (k) => {
    const detail =
      k.kind === 'required'
        ? `done when ${cond(k.when)}${k.withinSec !== undefined ? `; expected within ${k.withinSec} s (+${sc.latenessGraceSec} s grace)` : ''}`
        : k.kind === 'errorTrap'
          ? `${k.severity} error when ${cond(k.when)}; corrected if ${k.trappedWhen ? cond(k.trappedWhen) : '(never)'}${k.trapWithinSec !== undefined ? ` within ${k.trapWithinSec} s` : ''}`
          : k.kind === 'comm'
            ? `reply quality on \`${k.messageId}\`: ${Object.entries(k.quality).map(([card, q]) => `${card} = ${q}`).join(', ')}`
            : `safety-of-flight when ${cond(k.when)}`;
    return `| ${k.kind} | ${CATEGORY[k.category]} | ${k.reason.replace(/\|/g, '/')} | ${detail.replace(/\|/g, '/')} |`;
  };

  return { cond, cue, check };
}

function render(sc, flight) {
  const { cond, cue, check } = makeRenderer(sc);
  // Preserve the legacy review byte-for-byte; new flights describe their own initial state and review questions.
  const legacy = sc.id === 'single-source';
  const cross = sc.id === 'cross-check';
  const validation = legacy ? '' : ` **${PILOT_VALIDATION}**`;
  const initial = sc.initialAircraft;
  // The committed legacy review predates the voice-disclosure suffix. T43 explicitly preserves that
  // review's bytes; keep its historical notice while leaving the live scenario notice untouched.
  const reviewNotice = legacy ? sc.notice.replace(/ Voices are computer-generated\.$/, '') : sc.notice;
  const out = [];
  const p = (...lines) => out.push(...lines);

  p(
    `# ${sc.title} - scenario review copy`,
    '',
    '_Generated by `npm run export:review` (in `app/`) from `app/src/scenarios/' + sc.id + '.ts`. Do not edit this file by hand: edit the scenario file and export again._',
    '',
    '## How to review',
    '',
    'Thank you for reading this. It is the complete script of a short LOFT-style practice scenario that runs in a VR headset. The aircraft, airline, airports and procedures are all **invented**. Nothing here is copied from any operator, manufacturer or manual, and the app tells the user it is not a real or approved procedure.',
    '',
    'How the app works, so the script makes sense:',
    '',
    '- One pilot, seated, acting as captain and operating every control. The first officer speaks factual callouts and operates nothing.',
    legacy ? '- No hand flying. The aircraft follows the autopilot (heading, altitude, climb mode). Long phases are time-compressed (climb to 10,000 ft takes about 40 real seconds).' : cross ? '- No hand flying. The aircraft starts holding short of the runway, takes off by itself once the takeoff clearance is answered, and then climbs only with the autopilot engaged in climb mode. Climb is time-compressed (250 ft per real second); no descent, approach or landing is simulated.' : '- No hand flying. The aircraft starts in level cruise and follows autopilot heading commands. Motion is time-compressed; no descent or medical treatment is simulated.',
    '- The pilot "speaks" by tapping a reply card. Every unanswered message of the current Event Set keeps its cards on the comms panel (newest first) until one card is chosen.',
    legacy ? '- Each of Event Sets 1-3 also ends after 150 s, so a stuck user always reaches the debrief; anything not done by then is graded as missed.' : `- Event Sets advance using the conditions below; the final set times out after ${sc.softTimeout.afterSec} s. Missing work is graded as missed. No descent, approach or landing is simulated.`,
    '- An optional hint button says where to look, never what to decide. Using a hint is shown in the debrief.',
    '- Each Event Set is graded 1-4 automatically. 4: everything done, no uncorrected errors, good communication. 3: late items, corrected minor errors or a poor reply. 2: items done only after a hint, a corrected major error or an uncorrected minor error. 1: a safety-of-flight issue, a missed item or an uncorrected major error. The debrief shows up to three of the reasons listed under each set.',
    '',
    'What to look for:',
    '',
    '1. **Plausibility.** Would this sequence of events, and these consequences, feel credible in a real LOFT? Is anything missing that a crew would obviously do?',
    cross ? '2. **Phraseology.** Do the ATC and cabin lines and the reply cards sound natural and generic (ICAO-style), without sounding like any particular airline or region?' : '2. **Phraseology.** Do the ATC, cabin and dispatch lines and the reply cards sound natural and generic (ICAO-style), without sounding like any particular airline or region?',
    legacy ? '3. **Timing.** Is there enough time for each task? Is the 3-minute decision window in Event Set 4 reasonable?' : cross ? `3. **Timing.** Is there enough time for each task? In particular, is the time between the level-off call and flight level 110 enough (about 40 real seconds on the usual path, at least 20 in the worst case)? The aircraft climbs 125 ft per real second in this flight. Is the ${sc.softTimeout.afterSec} s final window reasonable?` : `3. **Timing.** Is there enough time for each task? Is the ${sc.softTimeout.afterSec} s final decision window reasonable?`,
    '4. **Grading.** Is each debrief reason fair, and is it worded as what happened and why it matters (not as an instruction)?',
    legacy ? '5. **Invented items.** Everything marked **INVENTED - VERIFY** is invented for a generic aircraft: procedures, but also the V-speeds, runway lengths, distances and ATIS values. Please check it is plausible and simple, not that it matches a real type.' : `5. **Invented items.** All new procedures and data are marked **${PILOT_VALIDATION}**. Check plausibility for a generic aircraft, not conformity to a real type.`,
    legacy ? '6. **Coaching lines.** Lines marked **COACHING - VERIFY** nudge a user who might otherwise sit waiting (for example dispatch recommending a cabin brief). Do they sound like something dispatch would really say, or do they give too much away?' : cross ? '6. **Coaching lines.** Do the first officer\'s "not climbing" remark, ATC\'s correction and real clearance, the cabin call-back and the timeout reminder sound natural without giving away the decision?' : '6. **Coaching lines.** Do the cabin follow-up, dispatch concern and timeout reminder sound natural without giving away the decision?',
    '7. **Anything that sounds copied or branded.** Flag it, even if unsure.',
    ...(flight.guided ? ['8. **Guided flight steps.** Do the instructions describe the step correctly and in plain words, without giving away a decision?'] : []),
    '',
    legacy ? 'Please comment by quoting the id in backticks (for example `es3-gen-failure / cab-lights`). Rule labels and instructor notes are only shown to an instructor, never in the headset.' : cross ? 'Please comment by quoting the id in backticks (for example `cc-es2-similar-callsign / cc-atc-417`). Rule labels and instructor notes are only shown to an instructor, never in the headset.' : 'Please comment by quoting the id in backticks (for example `tc-es2-cabin-call / tc-cabin-collapse`). Rule labels and instructor notes are only shown to an instructor, never in the headset.',
    '',
    '## Scenario settings',
    '',
    `- Notice shown before start: "${reviewNotice}"`,
    `- Time compression: x${sc.timeCompression} for aircraft motion. Lateness grace: ${sc.latenessGraceSec} s.`,
    `- Practice before Event Set 1: "${sc.practice.prompt}" (control \`${sc.practice.controlId}\`)`,
    legacy ? `- Initial aircraft: phase ${sc.initialAircraft.phase}, heading ${sc.initialAircraft.headingDeg}, altitude ${sc.initialAircraft.altitudeFt} ft, altimeter ${sc.initialAircraft.baroHpa} hPa, autopilot off (HDG ${sc.initialAircraft.ap.hdg}, ALT ${sc.initialAircraft.ap.alt}), lights off, GEN 1 and GEN 2 on, backup generator ${sc.initialAircraft.elec.backupGenInop ? 'INOP (deferred)' : 'serviceable'}, bus tie ${sc.initialAircraft.elec.busTie ? 'on' : 'off'}, radio ${sc.initialAircraft.comFreq}, destination ${sc.initialAircraft.destination}.` : `- Initial aircraft: phase ${initial.phase}, heading ${initial.headingDeg}, altitude ${initial.altitudeFt} ft, altimeter ${initial.baroHpa} hPa, autopilot ${initial.ap.engaged ? 'engaged' : 'off'} (HDG ${initial.ap.hdg}, ALT ${initial.ap.alt}, lateral ${initial.ap.lateral}, vertical ${initial.ap.vertical}), landing ${initial.lights.landing ? 'on' : 'off'}, strobe ${initial.lights.strobe ? 'on' : 'off'}, GEN 1 ${initial.elec.gen1.switchOn ? 'on' : 'off'} (${initial.elec.gen1.failed ? 'failed' : 'serviceable'}), GEN 2 ${initial.elec.gen2.switchOn ? 'on' : 'off'} (${initial.elec.gen2.failed ? 'failed' : 'serviceable'}), backup generator ${initial.elec.backupGenInop ? 'INOP' : 'serviceable'}, bus tie ${initial.elec.busTie ? 'on' : 'off'}, radio ${initial.comFreq}, destination ${initial.destination}, storm ${initial.stormBearingDeg === null ? 'none' : initial.stormBearingDeg}.`,
    '',
    '## Briefing (kneeboard, before Event Set 1)',
    '',
  );
  if (!legacy) p(`**${PILOT_VALIDATION}.** Every procedure, checklist line, reply card, ${cross ? 'clearance, altitude, heading, altimeter setting, airport name,' : 'medical report, airport profile,'} timing, error trap and grading judgment in this review is invented for this generic fictional exercise. The markers on messages also apply to their reply cards. No real or certified procedure is claimed.`, '');
  for (const b of sc.briefing) p(`**${b.title}**`, '', b.body.split('\n').map((l) => `> ${l}`).join('\n'), '');

  p('## Airports (all invented)', '', '| id | Name |', '| --- | --- |', ...sc.airports.map((a) => `| \`${a.id}\` | ${a.name} |`), '');

  p(legacy ? '## Checklists (INVENTED - VERIFY)' : '## Checklists (to be validated by the user (a pilot))', '');
  for (const c of sc.checklists) {
    p(`**${c.title}** (\`${c.id}\`) - ${legacy ? 'INVENTED - VERIFY' : PILOT_VALIDATION}`, '');
    c.items.forEach((it, i) => p(`${i + 1}. ${it.text} (\`${it.id}\`)${validation}`));
    p('');
  }

  p('## Event Sets', '');
  sc.eventSets.forEach((es, n) => {
    p(`### ${n + 1}. ${es.title} (\`${es.id}\`)`, '');
    if (!legacy) p(`**${PILOT_VALIDATION}:** all actions, communications, timing and checks in this Event Set.`, '');
    if (es.id === 'es3-gen-failure')
      p('**INVENTED - VERIFY:** the generator failure handling (alert, checklist, switch actions, error traps) is invented for a generic aircraft.', '');
    p(
      '| | |',
      '| --- | --- |',
      `| Phase | ${es.phase} |`,
      `| Environment | ${es.environment} |`,
      `| Distracters | ${es.distracters.join('; ') || '-'} |`,
      `| Trigger | ${es.trigger} |`,
      `| Technical focus | ${es.technical} |`,
      `| CRM focus | ${es.crm} |`,
      '',
      `**Objective.** ${es.objective}`,
      '',
      `**Instructor notes (instructor only).** ${es.instructorNotes}`,
      '',
      '**At the start of the set the pilot sees:**',
      '',
      ...(es.startCues.length ? es.startCues.map(cue) : ['- (nothing new)']),
      '',
    );
    if (es.id === sc.softTimeout.eventSetId) {
      p(
        `**Soft timeout.** At ${sc.softTimeout.promptAtSec} s into this set, if the scenario has not ended${sc.softTimeout.skipPromptWhen ? ` and this is NOT already true - ${cond(sc.softTimeout.skipPromptWhen)} -` : ''} the pilot sees:`,
        '',
        cue(sc.softTimeout.promptCue),
        '',
        `At ${sc.softTimeout.afterSec} s the scenario ends ("timeout") and this set is graded as it stands.`,
        '',
      );
    }
    p('**Conditional cues (when X happens, the world responds Y):**', '');
    if (!es.rules.length) p('- (none)');
    for (const r of es.rules) {
      p(`- **\`${r.id}\`** - ${r.instructorLabel}`, `  - When: ${cond(r.when)}${r.once === false ? ' (repeats)' : ''}`);
      for (const c of r.cues) p(cue(c).split('\n').map((l) => `  ${l}`).join('\n'));
    }
    p('', `**The set ends when:** ${n === sc.eventSets.length - 1 ? 'the scenario ends (see End conditions below).' : cond(es.endWhen)}`, '');
    p('**Checks and debrief reasons:**', '', '| Kind | Category | Debrief reason (pilot sees) | How it is judged |', '| --- | --- | --- | --- |', ...es.checks.map(check), '');
    p('**Hints (pilot sees on request):**', '', ...es.hints.map((h) => `- "${h}"`), '');
    if (es.guide?.length) {
      p('**Guided flight steps (shown only in GUIDED FLIGHT):**', '');
      p('The trainer frames the control, reply or checklist line to press and shows these two lines. At a decision every option is framed.', '');
      es.guide.forEach((g, n) => {
        p(`${n + 1}. \`${g.id}\` - ${g.where}`, `   > ${g.text}`);
        if (g.waitText) p(`   > While waiting: ${g.waitText}`);
        if (g.light.length > 1) p('   (a decision: every option is framed)');
        if (g.onlyWhen) p('   (shown only on one branch of an earlier choice)');
      });
      p('');
    }
  });

  p('## End conditions', '', 'The scenario ends as soon as one of these is true (checked continuously):', '');
  for (const e of sc.endConditions) p(`- **${e.reason}**: ${cond(e.when)}`);
  p(`- **timeout**: ${sc.softTimeout.afterSec} s into \`${sc.softTimeout.eventSetId}\` without ${sc.endConditions.length === 1 ? 'the above' : 'either of the above'}.`, '');
  if (legacy) p(
    '## Open questions for reviewers',
    '',
    '1. **Dispatch is informed automatically.** After the pilot requests a return or diversion from ATC, dispatch "copies" without the pilot sending anything. Should the pilot inform dispatch explicitly (an extra reply card)?',
    `2. **Return and ${sc.airports.find((a) => a.id === 'alt1').name} give the same debrief.** Both are acceptable and both grade 4 with no comment; the app only explains what went wrong. Is that acceptable, or should each acceptable choice get its own short debrief comment (needs an engine change)?`,
    `3. **Invented names.** Callsign "${sc.briefing[0].body.split(',')[0]}" and the places ${sc.airports.map((a) => `"${a.name}"`).join(', ')} are coined to be clearly fictional. Do any of them sound like a real airline, airport or place you know?`,
    '4. **Timing.** Is 8 s from the dispatch message to the Center call enough? Is the 110 s decision window (Center asks again at 120 s, timeout at 180 s) fair?',
    '5. **Event Set 2.** A plain readback of the climb clearance, followed by a deviation only after ATC raises the weather, is graded as a corrected minor error. Is that fair, given the reply cards allow only one transmission per call?',
    '6. **Event Set 3 checklist.** Is "GEN 1 OFF, bus tie ON, advise cabin, review remaining sources" a plausible minimal generic generator-fault checklist? Should it allow one reset attempt?',
    '',
  );
  if (cross) p(
    '## Open questions for reviewers', '',
    `**${PILOT_VALIDATION}:** the entire flight is a proposal for plausibility review.`, '',
    '1. **Amended clearance.** Is it plausible that Tower amends the heading, first altitude and QNH just before departure, and that the pilot should reset and cross-check all three before accepting an immediate departure? Accepting it with any old number is a major error, corrected only if all three are right before the takeoff read-back (the read-back starts the takeoff). Is that fair?',
    '2. **Immediate departure offer.** Both answers ("ready for immediate departure" and "standby, resetting") are graded as acceptable replies; only the old settings are the error. Is that the right balance? With no reply the clearance and takeoff follow by themselves.',
    '3. **Similar callsign.** Is the sequence plausible: a flight level 160 call for Corvane 417 on the shared frequency, then (in any case) the real flight level 140 for Corvane 471? Asking "was that for us" is best, "not our callsign" is acceptable, reading the other flight clearance back is poor, and setting the autopilot to 16000 is a major error corrected if it is reset to 14000 before the aircraft reaches 9,000 ft (the set ends there).',
    '4. **Level-off and the cabin.** Is stopping the climb at flight level 110 for traffic above, with a harmless galley call at the same moment, a fair test of priorities? Answering the cabin before the altitude is set is a minor error; climbing 300 ft or more through the stop altitude is a safety issue. "Standby" is graded better than "go ahead"; the cabin calls back about 8 s later.',
    '5. **Altitudes and numbers.** Review the transition altitude 6,000 ft, standard setting 1013 above it, QNH 1011 versus 1008, headings 270 versus 240, 4,000 versus 5,000 ft, flight levels 110, 140 and 160. All are invented for a fictional generic exercise, not real limits. The expected altimeter reminder is only the first officer\'s transition call-out.',
    '6. **Completion.** The flight is completed when the aircraft is level at 11,000 ft with the autopilot set to 11000, the altimeter at 1013 and the cabin call answered. Is that the right end? A pilot who never answers the cabin waits for the reminder and the 80 s timeout.',
    `7. **Names.** Callsigns "Corvane 471" and "Corvane 417" and the places ${sc.airports.map(a => a.name).join(', ')} are invented; flag any unintended resemblance to a real operator or place.`,
    '8. **Timing and hints.** About 20 s from the stop call to flight level 110, the 12 s wait before ATC gives the real clearance when there is no reply, and the fallbacks that keep the flight moving are all proposals. This flight has no guided steps. Voice clips for this flight are generated at integration; until then the lines show as captions.', '',
  );
  if (!legacy && !cross) p(
    '## Open questions for reviewers', '',
    `**${PILOT_VALIDATION}:** the entire flight is a proposal for plausibility review.`, '',
    '1. **Cruise and traffic.** Is the short cruise checklist plausible? Is setting heading 110 before the cabin conversation a fair workload-management expectation?',
    '2. **Fact gathering.** Are the questions about condition, attendance and a doctor appropriate for this fictional situation? Is the early commitment on the first cabin reply a fair corrected minor error?',
    '3. **Medical urgency and airport choice.** Does the larger airport balance hospital access, 25-minute flight time, runway and weather plausibly? Is the 15-minute option reasonably accepted with a lower grade? Confirming 1 hour 40 minutes to destination is graded 1; is that fair?',
    '4. **Invented numbers.** Review 3,100 m dry versus 1,550 m wet, crosswind 24 kt versus fictional limit 25 kt, weather, medical-team availability and all time estimates. Flight time is not hospital arrival time; no medical treatment or real aircraft limit is taught.',
    '5. **Coordination.** Is the explicit dispatch confirmation, medical-emergency request to ATC and cabin update natural? Does the cabin briefing need more detail about the selected airport or ETA?',
    '6. **Checklist and completion.** Cabin briefing, dispatch confirmation and the full diversion checklist are all required before diversion completion, in any order. Missing dispatch or checklist work waits for the 180 s soft timeout and is graded as missed. Is this fair? No descent is required or simulated.',
    `7. **Names.** Callsign "${sc.briefing[0].body.split(',')[0]}" and ${sc.airports.map(a => a.name).join(', ')} are invented; flag any unintended resemblance to a real operator or place.`,
    '8. **Timing and hints.** Are the 150 s early-set fallbacks, 110 s decision target, 120 s reminder and 180 s final timeout fair? This flight has no guided steps. Voice clips for this flight are generated at integration; until then the lines show as captions.', '',
  );
  return out.join('\n');
}

const server = await createServer({
  configFile: false,
  root: appDir,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { FLIGHTS } = await server.ssrLoadModule('/src/scenarios/registry.ts');
  mkdirSync(reviewDir, { recursive: true });
  for (const flight of FLIGHTS) {
    const md = render(flight.build(0), flight);
    const outFile = join(reviewDir, `${flight.id}-review.md`);
    writeFileSync(outFile, md.endsWith('\n') ? md : `${md}\n`);
    console.log(`wrote ${relative(process.cwd(), outFile)}`);
  }
} finally {
  await server.close();
}
