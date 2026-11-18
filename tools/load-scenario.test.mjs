import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadScenario } from './load-scenario.mjs';
import { planVoiceJobs, uniqueVoiceCues } from './voice-jobs.mjs';
import { collectVoiceCues } from './audio-cues.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
const digest = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const snapshotAudio = () => Object.fromEntries([
  ...readdirSync(new URL('../app/public/audio/voice/', import.meta.url)).map(f => `../app/public/audio/voice/${f}`),
  '../app/src/scenarios/single-source.voice.ts', '../docs/review/voice-provenance.json',
].map(path => [path, digest(path)]));

test('SSR loader exposes every registered flight/variation, with baseline first', async () => {
  const loaded = await loadScenario();
  try {
    const scenarios = loaded.allScenarios();
    assert.strictEqual(scenarios[0], loaded.singleSource);
    assert.equal(scenarios.filter(s => s.id === 'single-source').length, 12);
    assert.ok(new Set(scenarios.flatMap(collectVoiceCues).map(c => c.id)).size > collectVoiceCues(loaded.singleSource).length);
  } finally { await loaded.close(); }
});

test('voice dry-run includes variation lines, keeps fresh clips and writes nothing', async () => {
  const loaded = await loadScenario();
  let expected;
  try {
    const cues = uniqueVoiceCues(loaded.allScenarios().flatMap(collectVoiceCues));
    const provenance = JSON.parse(readFileSync(new URL('../docs/review/voice-provenance.json', import.meta.url), 'utf8'));
    expected = planVoiceJobs(cues, provenance, id => {
      try { return statSync(new URL(`../app/public/audio/voice/${id}.mp3`, import.meta.url)).size > 0; } catch { return false; }
    });
  } finally { await loaded.close(); }
  const before = snapshotAudio();
  const result = run(['tools/gen-voice.mjs', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Dry run: ${expected.todo.length} todo, ${expected.fresh.length} fresh, ${expected.orphans.length} orphans`));
  assert.match(result.stdout, /fo-es3-fault--g2/);
  assert.match(result.stdout, /dep-climb--n1/);
  assert.match(result.stdout, /ctr-ack-alt1--a2/);
  assert.match(result.stdout, /Nothing written\./);
  assert.deepEqual(snapshotAudio(), before);
});

test('audio export covers the same unique message union as the generator', async () => {
  const loaded = await loadScenario();
  try {
    const scenarios = loaded.allScenarios();
    const expectedIds = new Set(scenarios.flatMap(collectVoiceCues).map(c => c.id));
    const result = run(['tools/export-audio.mjs']);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.messageCount, expectedIds.size);
    assert.equal(summary.scenarioCount, scenarios.length);
    assert.deepEqual(summary.scenarioIds, [...new Set(scenarios.map(s => s.id))]);
  } finally { await loaded.close(); }
});

test('audio readiness gate: every message of every flight has a configured, present, fresh clip', () => {
  const result = run(['tools/export-audio.mjs', '--check']);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.ready, true);
  assert.equal(result.status, 0, result.stderr);
});
