import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_CHANNELS } from './audio-cues.mjs';
import {
  VOICE_MODEL, MODEL_FILES, VOICE_BY_CHANNEL, SPEED_BY_CHANNEL,
  langOf, toSpoken, inputHash, planVoiceJobs, provenanceEntry, voicedIdsInOrder,
} from './voice-jobs.mjs';

const mk = (id, channel = 'atc', text = `Line ${id}.`) => ({ id, channel, text, audio: `/audio/voice/${id}.mp3`, contentSha256: `hash-${id}-${text}`, configured: false });
const NOW = new Date('2026-11-14T12:00:00Z');
const recorded = jobs => Object.fromEntries(jobs.map(j => [j.cue.id, provenanceEntry(j, NOW)]));

test('toSpoken: radio numbers are spoken digit by digit on atc', () => {
  assert.equal(toSpoken('Orvessa 214, contact Center on 126.85. Good day.', 'atc'),
    'Orvessa two one four, contact Center on one two six decimal eight five. Good day.');
  assert.equal(toSpoken('Orvessa 214, Departure, radar contact. Climb and maintain 12,000 feet. Fly heading 090.', 'atc'),
    'Orvessa two one four, Departure, radar contact. Climb and maintain one two thousand feet. Fly heading zero nine zero.');
  assert.equal(toSpoken('Orvessa 214, wind 110 at 14, gusting 22, runway 09, cleared for takeoff.', 'atc'),
    'Orvessa two one four, wind one one zero at one four, gusting two two, runway zero nine, cleared for takeoff.');
  assert.equal(toSpoken('Orvessa 214, climb and maintain flight level 240.', 'atc'),
    'Orvessa two one four, climb and maintain flight level two four zero.');
});
test('toSpoken: other table rows (thousand, QNH, visibility, minutes) and ground', () => {
  assert.equal(toSpoken('Climb and maintain 4,000 feet.', 'ground'), 'Climb and maintain four thousand feet.');
  assert.equal(toSpoken('QNH 1004.', 'atc'), 'Q N H one zero zero four.');
  assert.equal(toSpoken('Isle Morrow reports fog, visibility 800 meters.', 'atc'), 'Isle Morrow reports fog, visibility eight hundred meters.');
  assert.equal(toSpoken('You are 20 minutes from the boundary.', 'atc'), 'You are 20 minutes from the boundary.');
  assert.equal(toSpoken('Hold short runway 09.', 'ground'), 'Hold short runway zero nine.');
});
test('toSpoken: other channels keep their numbers and only the callsign changes', () => {
  assert.equal(toSpoken('Orvessa 214, dispatch. The next 4.5 hours are over open water.', 'dispatch'),
    'Orvessa two one four, dispatch. The next 4.5 hours are over open water.');
  assert.equal(toSpoken('Runway 09 on 126.85.', 'cabin'), 'Runway 09 on 126.85.');
  assert.equal(toSpoken('Runway 09 on 126.85.', 'crew'), 'Runway 09 on 126.85.');
});
test('toSpoken: GEN 1 is spoken as gen one on every channel', () => {
  for (const channel of VOICE_CHANNELS) {
    assert.equal(toSpoken('Caution, GEN 1 FAULT.', channel), 'Caution, gen one fault.');
    assert.equal(toSpoken('GEN 2 is powering both buses.', channel), 'gen two is powering both buses.');
  }
});
test('langOf: a-voices are en-us, b-voices en-gb', () => {
  assert.equal(langOf('am_michael'), 'en-us');
  assert.equal(langOf('af_heart'), 'en-us');
  assert.equal(langOf('bf_emma'), 'en-gb');
  assert.equal(langOf('bm_george'), 'en-gb');
  assert.throws(() => langOf('zz_nobody'));
});
test('every channel in VOICE_CHANNELS has a voice and a speed', () => {
  for (const channel of VOICE_CHANNELS) {
    assert.match(VOICE_BY_CHANNEL[channel], /^[ab][fm]_[a-z]+$/);
    assert.ok(SPEED_BY_CHANNEL[channel] > 0);
  }
  assert.deepEqual(VOICE_BY_CHANNEL, { atc: 'am_michael', ground: 'am_fenrir', cabin: 'af_heart', dispatch: 'bf_emma', crew: 'am_puck' });
  assert.equal(VOICE_MODEL, 'kokoro-v1.0');
  assert.deepEqual(Object.keys(MODEL_FILES), ['kokoro-v1.0.onnx', 'voices-v1.0.bin']);
  for (const hash of Object.values(MODEL_FILES)) assert.match(hash, /^[0-9a-f]{64}$/);
});
test('planVoiceJobs: nothing recorded yet means every cue is todo', () => {
  const cues = [mk('a'), mk('b', 'cabin'), mk('c', 'crew')];
  const { todo, fresh, orphans } = planVoiceJobs(cues, {}, () => true);
  assert.equal(todo.length, cues.length);
  assert.deepEqual(fresh, []);
  assert.deepEqual(orphans, []);
  const job = todo[1];
  assert.equal(job.voice, 'af_heart');
  assert.equal(job.lang, 'en-us');
  assert.equal(job.speed, 1.0);
  assert.equal(job.model, 'kokoro-v1.0');
  assert.equal(job.spoken, 'Line b.');
  assert.match(job.inputSha256, /^[0-9a-f]{64}$/);
  assert.equal(todo[0].speed, 1.1);
});
test('planVoiceJobs: a fresh clip with matching inputSha256 is kept', () => {
  const cues = [mk('a'), mk('b', 'dispatch')];
  const prov = recorded(planVoiceJobs(cues, {}, () => true).todo);
  const { todo, fresh } = planVoiceJobs(cues, prov, () => true);
  assert.deepEqual(todo, []);
  assert.deepEqual(fresh.map(j => j.cue.id), ['a', 'b']);
});
test('planVoiceJobs: changed text makes the cue todo again', () => {
  const prov = recorded(planVoiceJobs([mk('a', 'atc', 'Old words.'), mk('b')], {}, () => true).todo);
  const { todo, fresh } = planVoiceJobs([mk('a', 'atc', 'New words.'), mk('b')], prov, () => true);
  assert.deepEqual(todo.map(j => j.cue.id), ['a']);
  assert.deepEqual(fresh.map(j => j.cue.id), ['b']);
});
test('planVoiceJobs: a changed voice, speed or model makes the cue todo again', () => {
  const cue = mk('a');
  const base = planVoiceJobs([cue], {}, () => true).todo[0];
  const prov = { a: provenanceEntry(base, NOW) };
  assert.equal(planVoiceJobs([cue], prov, () => true).fresh.length, 1);
  const spoken = base.spoken;
  const h = (model, voice, speed) => inputHash(cue, spoken, model, voice, speed);
  assert.equal(h('kokoro-v1.0', 'am_michael', 1.1), base.inputSha256);
  assert.notEqual(h('kokoro-v1.0', 'am_fenrir', 1.1), base.inputSha256);
  assert.notEqual(h('kokoro-v1.0', 'am_michael', 1.0), base.inputSha256);
  assert.notEqual(h('kokoro-v2.0', 'am_michael', 1.1), base.inputSha256);
  const stale = { a: { ...prov.a, inputSha256: h('kokoro-v1.0', 'am_fenrir', 1.1) } };
  assert.equal(planVoiceJobs([cue], stale, () => true).todo.length, 1);
});
test('inputHash: sha256 of the JSON array, per the contract', async () => {
  const { createHash } = await import('node:crypto');
  const cue = mk('a');
  assert.equal(inputHash(cue, 'sp', 'm', 'v', 1.1),
    createHash('sha256').update(JSON.stringify([cue.channel, cue.text, 'sp', 'm', 'v', 1.1])).digest('hex'));
});
test('planVoiceJobs: provenance without a clip file is todo', () => {
  const cues = [mk('a'), mk('b')];
  const prov = recorded(planVoiceJobs(cues, {}, () => true).todo);
  const { todo, fresh } = planVoiceJobs(cues, prov, id => id !== 'b');
  assert.deepEqual(todo.map(j => j.cue.id), ['b']);
  assert.deepEqual(fresh.map(j => j.cue.id), ['a']);
});
test('planVoiceJobs: provenance for a removed message is an orphan', () => {
  const prov = recorded(planVoiceJobs([mk('a'), mk('gone')], {}, () => true).todo);
  const { orphans, fresh } = planVoiceJobs([mk('a')], prov, () => true);
  assert.deepEqual(orphans, ['gone']);
  assert.deepEqual(fresh.map(j => j.cue.id), ['a']);
});
test('planVoiceJobs: an unknown channel throws', () => {
  assert.throws(() => planVoiceJobs([mk('a', 'tower')], {}, () => true), /channel/i);
});
test('provenanceEntry has the documented fields', () => {
  const job = planVoiceJobs([mk('a')], {}, () => true).todo[0];
  assert.deepEqual(provenanceEntry(job, NOW), {
    channel: 'atc', contentSha256: job.cue.contentSha256, inputSha256: job.inputSha256,
    model: 'kokoro-v1.0', voice: 'am_michael', speed: 1.1, generatedAt: '2026-11-14T12:00:00.000Z',
  });
});

test('planVoiceJobs: repeated ids across flights and variations produce one job, baseline first', () => {
  const { todo } = planVoiceJobs([mk('baseline'), mk('shared'), mk('shared'), mk('variation'), mk('new-flight')], {}, () => false);
  assert.deepEqual(todo.map(j => j.cue.id), ['baseline', 'shared', 'variation', 'new-flight']);
});

test('planVoiceJobs: a reused id with different text or channel fails across flights', () => {
  for (const conflict of [mk('shared', 'atc', 'Different words.'), mk('shared', 'cabin')]) {
    assert.throws(() => planVoiceJobs([mk('shared'), conflict], {}, () => false), /Conflicting message ID: shared/);
  }
});

test('toSpoken: both callsigns are spoken digit by digit on every channel', () => {
  for (const channel of VOICE_CHANNELS) {
    assert.equal(toSpoken('Velrune 638, still awaiting your intentions.', channel), 'Velrune six three eight, still awaiting your intentions.', channel);
    assert.equal(toSpoken('Orvessa 214, dispatch.', channel), 'Orvessa two one four, dispatch.', channel);
  }
  assert.equal(toSpoken('Velrune 638, turn heading 110 for traffic, maintain 26,000 feet.', 'atc'),
    'Velrune six three eight, turn heading one one zero for traffic, maintain two six thousand feet.');
  assert.equal(toSpoken('Velrune 638, dispatch. Call when ready.', 'dispatch'), 'Velrune six three eight, dispatch. Call when ready.');
  assert.equal(toSpoken('Velrune 638, Center.', 'crew'), 'Velrune six three eight, Center.');
  // T44 Cross-Check: our callsign and the similar one are both read digit by digit, so a listener hears the difference.
  assert.equal(toSpoken('Corvane 417, climb flight level 160.', 'atc'), 'Corvane four one seven, climb flight level one six zero.');
  assert.equal(toSpoken('Corvane 471, wind 270 at 6 knots, runway 27, cleared for takeoff.', 'atc'),
    'Corvane four seven one, wind two seven zero at six knots, runway two seven, cleared for takeoff.');
  assert.equal(toSpoken('Passing the transition altitude, 6,000 feet.', 'crew'), 'Passing the transition altitude, six thousand feet.');
});
test('toSpoken: crew reads a heading and a thousands figure as digits', () => {
  assert.equal(toSpoken('Heading 110, level at 26,000.', 'crew'), 'Heading one one zero, level at two six thousand.');
  assert.equal(toSpoken('Level at 26,000. Autopilot engaged, heading mode, altitude hold.', 'crew'),
    'Level at two six thousand. Autopilot engaged, heading mode, altitude hold.');
  assert.equal(toSpoken('Turn right heading 090.', 'crew'), 'Turn right heading zero nine zero.');
});
test('toSpoken: the crew number rules do not apply to cabin or dispatch', () => {
  for (const channel of ['cabin', 'dispatch']) {
    assert.equal(toSpoken('Heading 110, level at 26,000.', channel), 'Heading 110, level at 26,000.', channel);
  }
});

test('voicedIdsInOrder: cue order, only fresh clips, not alphabetical', () => {
  const cues = [mk('zulu'), mk('alpha', 'cabin'), mk('mike', 'crew'), mk('bravo', 'dispatch')];
  const plan = planVoiceJobs(cues, {}, () => true);
  const jobs = [...plan.todo];
  const prov = recorded(jobs);
  assert.deepEqual(voicedIdsInOrder(cues, jobs, prov, () => true), ['zulu', 'alpha', 'mike', 'bravo']);
  // Jobs may be listed in any order (todo first, then fresh): the result still follows the cues.
  assert.deepEqual(voicedIdsInOrder(cues, [...jobs].reverse(), prov, () => true), ['zulu', 'alpha', 'mike', 'bravo']);
  // A missing clip, missing provenance or stale input hash leaves the id out.
  assert.deepEqual(voicedIdsInOrder(cues, jobs, prov, id => id !== 'alpha'), ['zulu', 'mike', 'bravo']);
  const { mike, ...withoutMike } = prov;
  assert.deepEqual(voicedIdsInOrder(cues, jobs, withoutMike, () => true), ['zulu', 'alpha', 'bravo']);
  assert.deepEqual(voicedIdsInOrder(cues, jobs, { ...prov, bravo: { ...prov.bravo, inputSha256: 'stale' } }, () => true), ['zulu', 'alpha', 'mike']);
});
