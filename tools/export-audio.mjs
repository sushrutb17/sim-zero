#!/usr/bin/env node
// Offline preparation/readiness only. No API calls, credentials or paid service use.
// Usage: node tools/export-audio.mjs [--check] [--out workspace-relative.json]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVoiceCues, auditAudioAssets, VOICE_CHANNELS } from './audio-cues.mjs';
import { uniqueVoiceCues } from './voice-jobs.mjs';
import { loadScenario } from './load-scenario.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out;
let check = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') check = true;
  else if (args[i] === '--out' && args[i + 1]) out = resolve(root, args[++i]);
  else throw new Error('Usage: node tools/export-audio.mjs [--check] [--out workspace-relative.json]');
}
if (out) {
  const rel = relative(root, out);
  if (rel.startsWith('..') || isAbsolute(rel) || !out.endsWith('.json')) throw new Error('Output must be a JSON file inside the workspace.');
  // Do not let export overwrite source, task records, or proprietary references.
  if (!rel.startsWith('docs/review/') && !rel.startsWith('test-results/')) throw new Error('Export only to docs/review/ or test-results/.');
}
const appDir = join(root, 'app');
const provenancePath = join(root, 'docs/review/voice-provenance.json');
const provenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : {};
const { allScenarios, THEME, close } = await loadScenario();
try {
  const scenarios = allScenarios();
  const messages = uniqueVoiceCues(scenarios.flatMap(collectVoiceCues));
  const report = auditAudioAssets(messages, join(appDir, 'public'), Object.values(THEME.sfx).map(sfx => sfx.file), readFileSync(join(root, 'docs/asset-ledger.md'), 'utf8'), provenance);
  const summary = { scenarioIds: [...new Set(scenarios.map(s => s.id))], scenarioCount: scenarios.length, messageCount: messages.length, channels: Object.fromEntries(VOICE_CHANNELS.map(channel => [channel, messages.filter(cue => cue.channel === channel).length])), totalBytes: report.totalBytes, ready: !report.errors.length, errors: report.errors };
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ ...summary, status: report.errors.length ? 'preparation-only; content review and generation pending' : 'assets present; listening verification pending', messages }, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary, null, 2));
  if (check && report.errors.length) process.exitCode = 1;
} finally { await close(); }
