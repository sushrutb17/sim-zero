// Explicit pilot-visible cue traversal. Never export instructor notes/labels or reference scripts.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const VOICE_CHANNELS = Object.freeze(['atc', 'cabin', 'dispatch', 'ground', 'crew']);
const safeAudioPath = path => typeof path === 'string' && /^\/audio\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:mp3|wav|ogg)$/.test(path);
export function collectVoiceCues(scenario) {
  const found = new Map();
  const visit = cue => {
    if (cue.kind !== 'message') return;
    if (!/^[A-Za-z0-9_-]+$/.test(cue.id)) throw new Error('Message ID must be a safe filename.');
    if (!VOICE_CHANNELS.includes(cue.channel)) throw new Error(`Unknown channel for ${cue.id}.`);
    if (typeof cue.text !== 'string' || !cue.text.trim()) throw new Error(`Empty message ${cue.id}.`);
    const audio = `/audio/voice/${cue.id}.mp3`;
    if (cue.audio !== undefined && (!safeAudioPath(cue.audio) || cue.audio !== audio)) throw new Error(`Unexpected audio path for ${cue.id}.`);
    const line = {
      id: cue.id, channel: cue.channel, text: cue.text, audio,
      // A future offline generator must record this hash alongside its output.
      contentSha256: createHash('sha256').update(JSON.stringify([cue.channel, cue.text])).digest('hex'),
      configured: cue.audio === audio,
    };
    const previous = found.get(line.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(line)) throw new Error(`Conflicting message ID: ${line.id}.`);
    found.set(line.id, line);
  };
  for (const set of scenario.eventSets) {
    set.startCues.forEach(visit);
    for (const rule of set.rules) rule.cues.forEach(visit);
  }
  visit(scenario.softTimeout.promptCue);
  return [...found.values()];
}

export function auditAudioAssets(messages, publicDir, sfxPaths, ledgerText, provenance, maxBytes = 15_000_000) {
  const errors = [];
  let totalBytes = 0;
  const visit = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) { errors.push('Audio assets must not be symlinks.'); continue; }
      if (entry.isDirectory()) visit(path);
      else totalBytes += statSync(path).size;
    }
  };
  visit(join(publicDir, 'audio'));
  if (totalBytes > maxBytes) errors.push(`Audio budget exceeded: ${totalBytes} > ${maxBytes} bytes.`);
  for (const path of sfxPaths) {
    if (!safeAudioPath(path)) { errors.push('Unsafe SFX path.'); continue; }
    const file = join(publicDir, path.slice(1));
    if (!existsSync(file) || statSync(file).size === 0) errors.push(`Missing or empty SFX: ${path}`);
    if (!ledgerText.includes('`' + path.split('/').at(-1) + '`')) errors.push(`SFX missing from asset ledger: ${path}`);
  }
  for (const cue of messages) {
    if (!safeAudioPath(cue.audio)) { errors.push(`Unsafe voice path: ${cue.id}`); continue; }
    if (!cue.configured) errors.push(`Scenario audio field not configured: ${cue.id}`);
    const file = join(publicDir, cue.audio.slice(1));
    if (!existsSync(file) || statSync(file).size === 0) errors.push(`Missing or empty voice: ${cue.id}`);
    // Provenance lives in docs/review/voice-provenance.json, keyed by message id. It prevents
    // skip-existing logic from silently retaining a clip recorded from old text.
    const entry = provenance?.[cue.id];
    if (!entry || typeof entry !== 'object') errors.push(`Missing voice provenance: ${cue.id}`);
    else if (entry.contentSha256 !== cue.contentSha256) errors.push(`Stale or incomplete voice provenance: ${cue.id}`);
  }
  return { totalBytes, errors };
}
