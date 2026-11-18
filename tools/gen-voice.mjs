#!/usr/bin/env node
// Offline voice generator: Kokoro (local) renders WAVs, ffmpeg makes MP3s. No network, no API key.
// Usage: node tools/gen-voice.mjs [--dry-run] [--only <messageId>]
// Never prints message text; only ids, counts and character totals.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVoiceCues } from './audio-cues.mjs';
import { loadScenario } from './load-scenario.mjs';
import { MODEL_FILES, planVoiceJobs, provenanceEntry, uniqueVoiceCues, voicedIdsInOrder } from './voice-jobs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const voiceDir = join(root, 'app/public/audio/voice');
const provenancePath = join(root, 'docs/review/voice-provenance.json');
const voicedListPath = join(root, 'app/src/scenarios/single-source.voice.ts');
const python = join(root, 'tools/voice/.venv/bin/python');
const modelsDir = join(root, 'tools/voice/models');
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const USAGE = 'Usage: node tools/gen-voice.mjs [--dry-run] [--only <messageId>]';

let dryRun = false;
let only;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--only' && args[i + 1] && SAFE_ID.test(args[i + 1])) only = args[++i];
  else { console.error(USAGE); process.exit(2); }
}

const clipPath = id => join(voiceDir, `${id}.mp3`);
const hasClip = id => { try { return statSync(clipPath(id)).size > 0; } catch { return false; } };
const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const list = ids => ids.length ? ids.map(id => `  ${id}`).join('\n') : '  (none)';

const scenario = await loadScenario();
let exitCode = 0;
try {
  const cues = uniqueVoiceCues(scenario.allScenarios().flatMap(collectVoiceCues));
  if (only && !cues.some(cue => cue.id === only)) { console.error(`Unknown message id: ${only}`); process.exit(2); }
  const provenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : {};
  const plan = planVoiceJobs(cues, provenance, hasClip);
  const jobs = only ? plan.todo.filter(job => job.cue.id === only) : plan.todo;
  const characters = jobs.reduce((sum, job) => sum + job.spoken.length, 0);

  if (dryRun) {
    console.log(`todo (${jobs.length}):\n${list(jobs.map(job => job.cue.id))}`);
    console.log(`fresh (${plan.fresh.length}):\n${list(plan.fresh.map(job => job.cue.id))}`);
    console.log(`orphans (${plan.orphans.length}):\n${list(plan.orphans)}`);
    console.log(`Dry run: ${jobs.length} todo, ${plan.fresh.length} fresh, ${plan.orphans.length} orphans, ${characters} spoken characters. Nothing written.`);
  } else {
    const missingSetup = !existsSync(python) || Object.entries(MODEL_FILES).some(([name, hash]) => !existsSync(join(modelsDir, name)) || sha256File(join(modelsDir, name)) !== hash);
    if (jobs.length && missingSetup) { console.error('Run tools/voice/setup.sh first. Nothing was generated.'); process.exit(2); }
    if (jobs.length && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { console.error('ffmpeg is required on the PATH. Nothing was generated.'); process.exit(2); }

    mkdirSync(voiceDir, { recursive: true });
    const now = new Date();
    const produced = [];
    const failed = [];
    if (jobs.length) {
      const work = mkdtempSync(join(tmpdir(), 'trainer-voice-'));
      try {
        const jobsFile = join(work, 'jobs.json');
        writeFileSync(jobsFile, JSON.stringify(jobs.map(job => ({ id: job.cue.id, text: job.spoken, voice: job.voice, speed: job.speed, lang: job.lang }))));
        const render = spawnSync(python, ['-I', join(root, 'tools/voice/render.py'), jobsFile, modelsDir, work], { stdio: 'inherit' });
        if (render.status === 2 || render.error) { console.error('The renderer rejected its input or could not start. Nothing was generated.'); process.exit(2); }
        for (const job of jobs) {
          const id = job.cue.id;
          const wav = join(work, `${id}.wav`);
          const tmpMp3 = join(work, `${id}.mp3`);
          const encoded = existsSync(wav) && spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '64k', tmpMp3], { stdio: 'inherit' }).status === 0 && existsSync(tmpMp3) && statSync(tmpMp3).size > 0;
          if (!encoded) { failed.push(id); continue; }
          const dest = clipPath(id);
          const staged = `${dest}.tmp`;
          writeFileSync(staged, readFileSync(tmpMp3));
          renameSync(staged, dest);
          provenance[id] = provenanceEntry(job, now);
          produced.push(id);
        }
      } finally { rmSync(work, { recursive: true, force: true }); }
    }

    for (const id of plan.orphans) {
      if (SAFE_ID.test(id) && existsSync(clipPath(id))) unlinkSync(clipPath(id));
      delete provenance[id];
    }

    const sorted = Object.fromEntries(Object.keys(provenance).sort().map(id => [id, provenance[id]]));
    mkdirSync(dirname(provenancePath), { recursive: true });
    writeFileSync(provenancePath, JSON.stringify(sorted, null, 2) + '\n');

    // Voiced = a clip exists and its recorded input matches the current wording, voice, speed and model.
    // Written in cue order (registry order, baseline first) so a catalog built from the list loads the guided flight first.
    const voiced = voicedIdsInOrder(cues, [...plan.todo, ...plan.fresh], sorted, hasClip);
    writeFileSync(voicedListPath, `// GENERATED by tools/gen-voice.mjs. Do not edit. Message ids that have a fresh recorded clip, for every registered flight, in load order (the first flight's baseline first).\nexport const VOICED_MESSAGE_IDS: readonly string[] = ${JSON.stringify(voiced)};\n`);

    console.log(`Generated ${produced.length}, failed ${failed.length}, kept ${plan.fresh.length}, removed ${plan.orphans.length} orphans. Voiced list: ${voiced.length} of ${cues.length}.`);
    if (failed.length) { console.error(`Failed ids:\n${list(failed)}`); exitCode = 1; }
  }
} finally { await scenario.close(); }
process.exitCode = exitCode;
