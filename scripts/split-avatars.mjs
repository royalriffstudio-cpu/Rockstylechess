/**
 * One-time authoring script: slices the 12-badge rock avatar sheet
 * (assets/avatar/avatar_rock_12pcs_set.png, 500x500, transparent background)
 * into one square transparent PNG per avatar, named by its stable id in
 * src/constants/avatars.ts.
 *
 * The 12 circular badges sit in 4 columns x 3 rows. They are uniform size
 * (~113px) and centered in their column/row, but the layout is NOT an even
 * pixel grid (uneven gutters, ~37px vertical gaps between rows), so the crop
 * centers were measured from the sheet's alpha projections rather than
 * derived from width/12.
 *
 * Developer-run, not part of `expo start` / CI (same as
 * scripts/recolor-pieces.mjs, scripts/curate-puzzles.mjs). The 12 output PNGs
 * are committed; src/constants/avatars.ts require()s them statically.
 *
 * Usage (from repo root):  node scripts/split-avatars.mjs
 */
import { join } from 'node:path';

import Jimp from 'jimp';

const SRC = join(process.cwd(), 'assets', 'avatar', 'avatar_rock_12pcs_set.png');
const OUT_DIR = join(process.cwd(), 'assets', 'avatar');
const OUT_SIZE = 256; // upscaled from the ~113px source badge so RN downsamples
const CROP = 116; // per-badge square, ~flush with the ~113px circular badge so
// it fills PlayerAvatar's circular clip edge-to-edge (no bgPanel ring)

// Badge centers on the 500x500 sheet, measured from the alpha projections.
const COL_CX = [72, 190, 309, 427];
const ROW_CY = [100, 250, 399];

// Row-major, matching src/constants/avatars.ts's AVATARS array order.
const IDS = [
  'axe', 'nova', 'riff', 'axl',
  'blaze', 'beats', 'mic-drop', 'synth',
  'reaper', 'king', 'rebel', 'legend',
];

const sheet = await Jimp.read(SRC);

for (let i = 0; i < IDS.length; i += 1) {
  const cx = COL_CX[i % 4];
  const cy = ROW_CY[Math.floor(i / 4)];
  const sx = Math.round(cx - CROP / 2);
  const sy = Math.round(cy - CROP / 2);

  const badge = sheet
    .clone()
    .crop(sx, sy, CROP, CROP)
    .resize(OUT_SIZE, OUT_SIZE, Jimp.RESIZE_BICUBIC);

  const dest = join(OUT_DIR, `${IDS[i]}.png`);
  await badge.writeAsync(dest);
  console.log(`${IDS[i].padEnd(9)} crop (${sx},${sy}) ${CROP}x${CROP} -> ${dest}`);
}

console.log(`\nDone -- ${IDS.length} avatars at ${OUT_SIZE}x${OUT_SIZE}.`);
