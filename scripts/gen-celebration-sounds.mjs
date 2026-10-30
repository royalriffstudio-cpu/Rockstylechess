/**
 * Generates the PLACEHOLDER celebration sounds (synthesised, no external audio):
 *   assets/sounds/level-up.wav  -- rising major arpeggio + sparkle, ~1.3 s
 *   assets/sounds/reward.wav    -- two quick coin-like pings, ~0.45 s
 *   assets/sounds/title.wav     -- short regal two-note fanfare, ~0.9 s
 * They are deliberately simple stand-ins so the moments have sound from day one;
 * swap the files for real audio later (same names, 16-bit PCM WAV) with no code change.
 *
 * Usage (repo root): node scripts/gen-celebration-sounds.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;
const OUT = join(process.cwd(), 'assets', 'sounds');

// A note: sine + a quiet octave harmonic, with an attack/decay envelope.
function note(freq, start, dur, vol, out) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.012);
    const decay = Math.exp(-3.2 * (t / dur));
    const sample = (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 3 * t)) * attack * decay * vol;
    out[s0 + i] = (out[s0 + i] ?? 0) + sample;
  }
}

function wav(samples) {
  // Soft-limit then 16-bit stereo like the existing move/capture sounds.
  const buf = Buffer.alloc(44 + samples.length * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, Math.tanh((samples[i] ?? 0) * 0.9)));
    const s = Math.round(v * 30000);
    buf.writeInt16LE(s, 44 + i * 4);
    buf.writeInt16LE(s, 46 + i * 4);
  }
  return buf;
}

const make = (seconds, build) => {
  const out = new Array(Math.floor(seconds * RATE)).fill(0);
  build(out);
  return wav(out);
};

// C major arpeggio up an octave, then a held top chord.
writeFileSync(join(OUT, 'level-up.wav'), make(1.4, (o) => {
  [261.63, 329.63, 392.0, 523.25].forEach((f, i) => note(f, i * 0.11, 0.5, 0.32, o));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(f, 0.5, 0.85, 0.22, o));
  note(2093.0, 0.62, 0.5, 0.08, o);
}));
writeFileSync(join(OUT, 'reward.wav'), make(0.5, (o) => {
  note(987.77, 0, 0.18, 0.4, o);
  note(1318.51, 0.09, 0.3, 0.4, o);
}));
writeFileSync(join(OUT, 'title.wav'), make(1.0, (o) => {
  note(392.0, 0, 0.35, 0.35, o);
  note(523.25, 0.18, 0.7, 0.35, o);
  note(659.25, 0.18, 0.7, 0.22, o);
}));
console.log('Wrote level-up.wav, reward.wav, title.wav');
