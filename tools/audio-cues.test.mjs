import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectVoiceCues, auditAudioAssets } from './audio-cues.mjs';

const cue = { kind: 'message', id: 'm-one', channel: 'atc', text: 'Original message.' };
const scenario = () => ({
  instructorNotes: 'PRIVATE TEST MARKER',
  eventSets: [{ instructorNotes: 'PRIVATE TEST MARKER', startCues: [cue], rules: [{ instructorLabel: 'PRIVATE TEST MARKER', cues: [{ ...cue }, { ...cue, id: 'm-two', channel: 'cabin' }] }] }],
  softTimeout: { promptCue: { ...cue, id: 'm-timeout', channel: 'dispatch' } },
});
test('exports start, conditional and timeout cues once; omits instructor fields', () => {
  const out = collectVoiceCues(scenario());
  assert.deepEqual(out.map(c => c.id), ['m-one', 'm-two', 'm-timeout']);
  assert.ok(!JSON.stringify(out).includes('PRIVATE TEST MARKER'));
  assert.equal(out[0].audio, '/audio/voice/m-one.mp3');
  assert.equal(out[0].configured, false);
});
test('content hash changes when text or channel changes', () => {
  const a = scenario(); const hash = collectVoiceCues(a)[0].contentSha256;
  a.eventSets[0].rules = [];
  a.eventSets[0].startCues = [{ ...cue, text: 'Changed original message.' }];
  assert.notEqual(collectVoiceCues(a)[0].contentSha256, hash);
  a.eventSets[0].startCues = [{ ...cue, channel: 'ground' }];
  assert.notEqual(collectVoiceCues(a)[0].contentSha256, hash);
});
test('accepts a crew (first officer) cue', () => {
  const a = scenario(); a.eventSets[0].rules = [];
  a.eventSets[0].startCues = [{ ...cue, id: 'fo-line', channel: 'crew' }];
  assert.equal(collectVoiceCues(a)[0].channel, 'crew');
});
test('rejects conflicting duplicate IDs', () => {
  const a = scenario(); a.eventSets[0].rules[0].cues[0] = { ...cue, text: 'Conflict' };
  assert.throws(() => collectVoiceCues(a), /Conflicting/);
});
test('rejects traversal, unknown channels, empty text and mismatched audio', () => {
  for (const patch of [{ id: '../secret' }, { channel: 'unknown' }, { text: '' }, { audio: '/audio/%2e%2e/key.mp3' }, { audio: '/audio/voice/other.mp3' }]) {
    const a = scenario(); a.eventSets[0].startCues = [{ ...cue, ...patch }];
    assert.throws(() => collectVoiceCues(a));
  }
});
test('readiness catches missing clips, unconfigured fields, stale provenance and size budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'trainer-audio-test-'));
  try {
    const messages = collectVoiceCues(scenario());
    const missing = auditAudioAssets(messages, root, ['/audio/sfx/click.mp3'], '', {});
    assert.ok(missing.errors.some(e => e.includes('Missing or empty voice')));
    assert.ok(missing.errors.some(e => e.includes('not configured')));
    assert.ok(missing.errors.some(e => e === 'Missing voice provenance: m-one'));
    assert.ok(missing.errors.some(e => e.includes('ledger')));
    mkdirSync(join(root, 'audio/voice'), { recursive: true });
    mkdirSync(join(root, 'audio/sfx'), { recursive: true });
    writeFileSync(join(root, 'audio/sfx/click.mp3'), 'fake test audio');
    const provenance = {};
    for (const message of messages) {
      message.configured = true;
      writeFileSync(join(root, message.audio.slice(1)), 'fake test audio');
      provenance[message.id] = { channel: message.channel, contentSha256: message.contentSha256, model: 'test-model', voice: 'test-voice' };
    }
    assert.deepEqual(auditAudioAssets(messages, root, ['/audio/sfx/click.mp3'], '`click.mp3`', provenance).errors, []);
    // No per-clip .json metadata files are read or required any more.
    assert.ok(!existsSync(join(root, messages[0].audio.slice(1)) + '.json'));
    const staleProv = { ...provenance, [messages[0].id]: { ...provenance[messages[0].id], contentSha256: 'stale' } };
    const stale = auditAudioAssets(messages, root, ['/audio/sfx/click.mp3'], '`click.mp3`', staleProv, 1);
    assert.ok(stale.errors.includes('Stale or incomplete voice provenance: m-one'));
    assert.ok(stale.errors.some(e => e.includes('budget exceeded')));
    assert.ok(!stale.errors.some(e => e.includes('m-two') && e.includes('provenance')));
    const { 'm-two': _dropped, ...partial } = provenance;
    const absent = auditAudioAssets(messages, root, ['/audio/sfx/click.mp3'], '`click.mp3`', partial);
    assert.deepEqual(absent.errors, ['Missing voice provenance: m-two']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
