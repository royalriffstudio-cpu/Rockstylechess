/**
 * Turns the raw celebration recordings into the files the app plays:
 *   assets/sounds/<name>_raw.wav  ->  assets/sounds/<name>.wav
 * for level-up, reward, title and run-over.
 *
 * The raws are 24-bit/48 kHz recordings with ~1.5-1.9 s of digital silence in front and a long, inaudible reverb
 * tail behind. Per file this script
 *   1. finds where the sound really starts and ends (10 ms RMS windows, -50 dBFS threshold), keeping 10 ms of
 *      lead-in and 30 ms of tail so nothing is clipped,
 *   2. cuts there, adds a 4 ms fade-in and a short fade-out (no clicks),
 *   3. converts to 16-bit / 44.1 kHz stereo like every other sound in assets/sounds,
 *   4. measures integrated loudness (EBU R128, on a copy padded with silence so even a 0.3 s blip is measured
 *      correctly) and applies the gain that reaches the cue's target, with a limiter holding the peak at -1 dBFS.
 * The _raw.wav files stay in the folder as the editable source (Metro only bundles what the code require()s).
 *
 * Needs ffmpeg on PATH. Usage (repo root): node scripts/process-celebration-sounds.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'assets', 'sounds');
const OUT_RATE = 44100;
const THRESHOLD_DB = -50; // "there is sound here"
const LEAD_IN_S = 0.01;
const TAIL_S = 0.03;
const PEAK_CEILING = 0.891; // -1 dBFS

// Integrated loudness each cue is brought to (the move/capture SFX sit around -15 LUFS). Level-up and title are the
// big moments; the reward ping happens often, so it is the quietest; "run over" is a downer and stays below them.
const TARGETS = [
  { name: 'level-up', lufs: -14, fadeOut: 0.18 },
  { name: 'title', lufs: -15, fadeOut: 0.2 },
  { name: 'reward', lufs: -17, fadeOut: 0.08 },
  { name: 'run-over', lufs: -16, fadeOut: 0.2 },
];

function ffmpeg(args, { capture = 'stdout' } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', capture === 'stderr' ? 'info' : 'error', ...args], {
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
  return capture === 'stderr' ? r.stderr.toString() : r.stdout;
}

/** [firstSoundSeconds, lastSoundSeconds] of the raw file. */
function findSound(file) {
  const pcm = ffmpeg(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-']);
  const f = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const win = 480 * 2; // 10 ms of stereo samples
  let first = -1;
  let last = -1;
  for (let i = 0, frame = 0; i + win <= f.length; i += win, frame++) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += f[j] * f[j];
    const db = 10 * Math.log10(sum / win + 1e-12);
    if (db > THRESHOLD_DB) {
      if (first < 0) first = frame;
      last = frame;
    }
  }
  if (first < 0) throw new Error(`${file}: no sound above ${THRESHOLD_DB} dBFS`);
  return [first * 0.01, (last + 1) * 0.01];
}

function loudnessLufs(trimFilter, file) {
  // Padding with silence changes nothing (blocks below the absolute gate are ignored) but lets ebur128 form its 400 ms blocks.
  const log = ffmpeg(['-i', file, '-af', `${trimFilter},apad=whole_dur=3,ebur128`, '-f', 'null', '-'], { capture: 'stderr' });
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const m = summary.match(/I:\s+(-?[\d.]+)\s+LUFS/);
  if (!m) throw new Error(`${file}: could not read loudness`);
  return Number(m[1]);
}

function measure(file) {
  const log = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { capture: 'stderr' });
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return {
    lufs: Number(summary.match(/I:\s+(-?[\d.]+)\s+LUFS/)?.[1]),
    peak: Number(summary.match(/Peak:\s+(-?[\d.]+)\s+dBFS/)?.[1]),
  };
}

for (const { name, lufs, fadeOut } of TARGETS) {
  const raw = join(DIR, `${name}_raw.wav`);
  const out = join(DIR, `${name}.wav`);
  if (!existsSync(raw)) {
    console.log(`skip ${name}: ${name}_raw.wav not found`);
    continue;
  }
  const [soundStart, soundEnd] = findSound(raw);
  const start = Math.max(0, soundStart - LEAD_IN_S);
  const end = soundEnd + TAIL_S;
  const dur = end - start;
  const fade = Math.min(fadeOut, dur / 3);
  const trim = `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=${OUT_RATE}`;

  const current = loudnessLufs(trim, raw);
  const gainDb = lufs - current;
  const chain = [
    trim,
    'afade=t=in:st=0:d=0.004',
    `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
    `volume=${gainDb.toFixed(2)}dB`,
    `alimiter=limit=${PEAK_CEILING}:attack=1:release=30:level=disabled`,
  ].join(',');
  ffmpeg(['-y', '-i', raw, '-af', chain, '-ac', '2', '-ar', String(OUT_RATE), '-c:a', 'pcm_s16le', out]);

  const m = measure(out);
  console.log(
    `${name.padEnd(9)} ${soundStart.toFixed(2)}s-${soundEnd.toFixed(2)}s of raw -> ${dur.toFixed(2)}s | gain ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB | ${m.lufs} LUFS (target ${lufs}) | peak ${m.peak} dBFS`,
  );
}
