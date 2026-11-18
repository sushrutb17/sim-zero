// Pure helpers for the offline voice generator: spoken text, job planning, provenance.
// No file, network or process access here; tools/gen-voice.mjs does the I/O.
import { createHash } from 'node:crypto';

export const VOICE_MODEL = 'kokoro-v1.0';
export const MODEL_FILES = Object.freeze({
  'kokoro-v1.0.onnx': '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5',
  'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
});
export const VOICE_BY_CHANNEL = Object.freeze({ atc: 'am_michael', ground: 'am_fenrir', cabin: 'af_heart', dispatch: 'bf_emma', crew: 'am_puck' });
export const SPEED_BY_CHANNEL = Object.freeze({ atc: 1.1, ground: 1.1, cabin: 1.0, dispatch: 1.0, crew: 1.0 });

export function langOf(voice) {
  if (/^a[fm]_/.test(voice)) return 'en-us';
  if (/^b[fm]_/.test(voice)) return 'en-gb';
  throw new Error(`Unknown voice prefix: ${voice}`);
}

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const digits = text => [...text].map(d => DIGIT[Number(d)]).join(' ');

// Callsigns of the registered flights. Every one is spoken digit by digit on every channel.
const CALLSIGNS = ['Orvessa', 'Velrune', 'Corvane'];
const CALLSIGN_RE = new RegExp(`\\b(${CALLSIGNS.join('|')}) (\\d+)\\b`, 'g');

// INVENTED - VERIFY (pilot reviewers): spoken-number rules for the generated voice only.
// The callsign, GEN and FAULT rules apply to every channel. The radio-number rules apply only to atc and ground.
// The crew (first officer) channel has two rules of its own: "heading NNN" and "NN,000" read as digits.
// FAULT is printed in capitals because it is an alert legend; spoken in capitals a TTS engine may spell it out.
export function toSpoken(text, channel) {
  let out = text
    .replace(CALLSIGN_RE, (_, name, n) => `${name} ${digits(n)}`)
    .replace(/\bGEN ([12])\b/g, (_, n) => `gen ${digits(n)}`)
    .replace(/\bFAULT\b/g, 'fault');
  if (channel === 'crew') {
    return out
      .replace(/\b(heading) (\d{3})\b/gi, (_, w, n) => `${w} ${digits(n)}`)
      .replace(/\b(\d{1,2}),000\b/g, (_, n) => `${digits(n)} thousand`);
  }
  if (channel !== 'atc' && channel !== 'ground') return out;
  out = out
    .replace(/\b(\d{3})\.(\d{2})\b/g, (_, a, b) => `${digits(a)} decimal ${digits(b)}`)
    .replace(/\b(runway) (\d{2})\b/gi, (_, w, n) => `${w} ${digits(n)}`)
    .replace(/\b(heading) (\d{3})\b/gi, (_, w, n) => `${w} ${digits(n)}`)
    .replace(/\b(flight level) (\d{3})\b/gi, (_, w, n) => `${w} ${digits(n)}`)
    .replace(/\b(\d{1,2}),000 feet\b/g, (_, n) => `${digits(n)} thousand feet`)
    .replace(/\b(wind) (\d{3}) at (\d{1,2})\b/gi, (_, w, d, s) => `${w} ${digits(d)} at ${digits(s)}`)
    .replace(/\b(gusting) (\d{1,2})\b/gi, (_, w, n) => `${w} ${digits(n)}`)
    .replace(/\bQNH (\d{4})\b/g, (_, n) => `Q N H ${digits(n)}`)
    .replace(/\b(visibility) (\d{3}) meters\b/gi, (_, w, n) => `${w} ${n.endsWith('00') ? `${DIGIT[Number(n[0])]} hundred` : digits(n)} meters`);
  return out;
}

export function inputHash(cue, spoken, model, voice, speed) {
  return createHash('sha256').update(JSON.stringify([cue.channel, cue.text, spoken, model, voice, speed])).digest('hex');
}

/** Union of all flight/variation cues, preserving baseline-first order and rejecting id collisions. */
export function uniqueVoiceCues(cues) {
  const found = new Map();
  for (const cue of cues) {
    const previous = found.get(cue.id);
    if (previous && (previous.text !== cue.text || previous.channel !== cue.channel)) {
      throw new Error(`Conflicting message ID: ${cue.id}.`);
    }
    // A shared line may already have audio configured by one of its flights.
    if (!previous || (!previous.configured && cue.configured)) found.set(cue.id, cue);
  }
  return [...found.values()];
}

// provenance: parsed docs/review/voice-provenance.json ({} when absent). hasClip(id): the mp3 exists and is non-empty.
export function planVoiceJobs(cues, provenance, hasClip) {
  const todo = [];
  const fresh = [];
  for (const cue of uniqueVoiceCues(cues)) {
    if (!Object.hasOwn(VOICE_BY_CHANNEL, cue.channel)) throw new Error(`No voice configured for channel "${cue.channel}" (message ${cue.id}).`);
    const voice = VOICE_BY_CHANNEL[cue.channel];
    const speed = SPEED_BY_CHANNEL[cue.channel];
    const spoken = toSpoken(cue.text, cue.channel);
    const job = { cue, spoken, voice, speed, lang: langOf(voice), model: VOICE_MODEL, inputSha256: inputHash(cue, spoken, VOICE_MODEL, voice, speed) };
    (provenance[cue.id]?.inputSha256 === job.inputSha256 && hasClip(cue.id) ? fresh : todo).push(job);
  }
  const ids = new Set(cues.map(cue => cue.id));
  const orphans = Object.keys(provenance).filter(id => !ids.has(id));
  return { todo, fresh, orphans };
}

/**
 * Message ids that have a fresh clip: the file exists, and the recorded input matches the current wording, voice, speed and model.
 * Returned in the order of `cues` (the registry's order: the first flight's baseline first), so a catalog built from the list
 * loads the guided flight's clips first. jobs: the planned jobs (todo and fresh) for those cues; provenance: the recorded entries.
 */
export function voicedIdsInOrder(cues, jobs, provenance, hasClip) {
  const current = new Map(jobs.map(job => [job.cue.id, job.inputSha256]));
  const ids = [];
  for (const cue of cues) {
    if (!ids.includes(cue.id) && current.has(cue.id) && hasClip(cue.id) && provenance[cue.id]?.inputSha256 === current.get(cue.id)) ids.push(cue.id);
  }
  return ids;
}

export function provenanceEntry(job, now) {
  return {
    channel: job.cue.channel, contentSha256: job.cue.contentSha256, inputSha256: job.inputSha256,
    model: job.model, voice: job.voice, speed: job.speed, generatedAt: now.toISOString(),
  };
}
