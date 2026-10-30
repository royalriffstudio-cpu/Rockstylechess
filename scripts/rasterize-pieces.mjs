/**
 * Developer-run: pre-renders every chess-piece SVG to a PNG the app can decode cheaply.
 *
 * Why: the piece SVGs are auto-traced vectors with hundreds of paths (170 KB - 1.5 MB each).
 * Decoding and drawing 12 of them at once when a match screen mounts hung the GPU of a
 * low-end Adreno 610 phone (render thread killed, app frozen/flickering, then crashed). A PNG
 * decodes in a few ms and costs the GPU a plain textured quad. The SVGs stay in assets/pieces
 * as the source of truth; the app only ever requires the PNGs (src/components/ui/pieceSprites.ts).
 *
 *   assets/pieces/{k}.svg           -> assets/pieces/png/classic/{k}.png
 *   assets/pieces/<set>/{k}.svg     -> assets/pieces/png/<set>/{k}.png
 *
 * Usage (repo root): node scripts/rasterize-pieces.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const require = createRequire(join(ROOT, 'store-assets/tools/package.json'));
const { chromium } = require('playwright');

const SIZE = 256;
const SETS = [
  ['classic', join(ROOT, 'assets/pieces')],
  ['graphite-tour', join(ROOT, 'assets/pieces/graphite-tour')],
  ['molten-gold', join(ROOT, 'assets/pieces/molten-gold')],
  ['crimson-reaper', join(ROOT, 'assets/pieces/crimson-reaper')],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
let count = 0;
for (const [name, dir] of SETS) {
  const out = join(ROOT, 'assets/pieces/png', name);
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    const svg = readFileSync(join(dir, file), 'utf8');
    const b64 = Buffer.from(svg).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" style="width:${SIZE}px;height:${SIZE}px;object-fit:contain;display:block" src="data:image/svg+xml;base64,${b64}"></body></html>`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    writeFileSync(join(out, file.replace('.svg', '.png')), png);
    count++;
  }
}
await browser.close();
console.log(`Wrote ${count} PNGs at ${SIZE}px to assets/pieces/png/.`);
