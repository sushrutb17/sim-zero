import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthesizeSfx, SFX_SECONDS } from './gen-sfx.mjs';

for (const [name, seconds] of Object.entries(SFX_SECONDS)) {
  test(`${name}: original PCM is deterministic, non-silent, finite and below full scale`, () => {
    const wav = synthesizeSfx(name);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal((wav.length - 44) / 2 / 24000, seconds);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 0 && peak < 32767);
    assert.equal(createHash('sha256').update(wav).digest('hex'), createHash('sha256').update(synthesizeSfx(name)).digest('hex'));
    if (name === 'ambient') assert.ok(Math.abs(wav.readInt16LE(44) - wav.readInt16LE(wav.length - 2)) <= 1);
  });
}
