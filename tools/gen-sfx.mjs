#!/usr/bin/env node
// Original deterministic synthesis. No recordings, sample libraries, branded alert patterns,
// or network services. FFmpeg only encodes our PCM samples as MP3.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SAMPLE_RATE = 24000;
export const SFX_SECONDS = Object.freeze({ click: 0.05, alertWarning: 1.2, alertCaution: 0.5, chime: 0.6, ambient: 24, radioIn: 0.12 });
const TAU = 2 * Math.PI;
function noise(seed = 214) {
  let state = seed;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x80000000 - 1; };
}
const envelope = (t, length, attack = 0.008) => t < 0 || t >= length ? 0 : Math.min(1, t / attack) * Math.sin(Math.PI * (1 - t / length) / 2) ** 2;

/** Returns mono PCM WAV bytes, so provenance is reproducible without an audio service. */
export function synthesizeSfx(name) {
  if (!Object.hasOwn(SFX_SECONDS, name)) throw new Error(`Unknown SFX: ${name}`);
  const count = Math.round(SFX_SECONDS[name] * SAMPLE_RATE);
  const data = new Float64Array(count);
  const random = noise(214 + name.length);
  let low = 0;
  let slow = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const white = random();
    low += 0.17 * (white - low);
    slow += 0.018 * (white - slow);
    if (name === 'click') data[i] = (0.6 * Math.sin(TAU * 1180 * t) + 0.4 * white) * Math.exp(-t * 125) * Math.min(1, t / 0.001);
    if (name === 'alertWarning') {
      for (let j = 0; j < 3; j++) {
        const dt = t - j * 0.2;
        data[i] += (Math.sin(TAU * (700 + j * 200) * dt) + 0.12 * Math.sin(TAU * (2100 + j * 600) * dt)) * envelope(dt, 0.15);
      }
    }
    if (name === 'alertCaution') {
      for (let j = 0; j < 2; j++) {
        const dt = t - j * 0.23;
        data[i] += Math.sin(TAU * (j ? 495 : 660) * dt) * envelope(dt, 0.24);
      }
    }
    if (name === 'chime') data[i] = (Math.sin(TAU * 820 * t) + 0.16 * Math.sin(TAU * 1640 * t)) * Math.exp(-t * 8) * envelope(t, 0.6);
    if (name === 'radioIn') data[i] = (white - low) * envelope(t, 0.12, 0.006);
    if (name === 'ambient') data[i] = 0.75 * slow + 0.14 * low + 0.025 * Math.sin(TAU * 96 * t) + 0.018 * Math.sin(TAU * 120 * t);
  }
  if (name === 'ambient') {
    // Overlap the final 0.25 s with an extrapolated start: end-to-start boundary
    // follows the same samples as the loop's beginning, without a silent fade.
    const overlap = SAMPLE_RATE / 4;
    for (let i = 0; i < overlap; i++) {
      const a = i / (overlap - 1);
      data[count - overlap + i] = data[count - overlap + i] * (1 - a) + data[i] * a;
    }
    // Match the endpoint itself; final listen/device tuning is still required.
    const delta = data[count - 1] - data[0];
    for (let i = 0; i < overlap; i++) data[count - overlap + i] -= delta * i / (overlap - 1);
  }
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  const scale = peak ? 0.8 / peak : 0;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(data[i] * scale * 32767), 44 + i * 2);
  return wav;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app/public/audio/sfx');
  mkdirSync(out, { recursive: true });
  // Preflight before writing assets; caller needs FFmpeg with libmp3lame.
  const check = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('FFmpeg with libmp3lame is required to encode original SFX.');
  const temp = mkdtempSync(join(tmpdir(), 'trainer-sfx-'));
  try {
  for (const name of Object.keys(SFX_SECONDS)) {
    const target = join(temp, `${name}.mp3`);
    const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '96k', '-write_xing', '1', target], { input: synthesizeSfx(name), maxBuffer: 2 * 1024 * 1024 });
    if (encoded.status !== 0) throw new Error(`Encoding failed for ${name}: ${encoded.stderr.toString()}`);
    const bytes = readFileSync(target);
    writeFileSync(join(out, `${name}.mp3`), bytes);
    console.log(`${name}.mp3: ${bytes.length} bytes`);
  }
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
