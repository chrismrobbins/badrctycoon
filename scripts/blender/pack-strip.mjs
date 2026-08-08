#!/usr/bin/env node
/**
 * Packs a directory of Blender-rendered frames into the horizontal sprite
 * strip the game loads.
 *
 *   node scripts/blender/pack-strip.mjs carousel
 *
 * Input:  scripts/blender/out/<name>/f00.png .. fNN.png + meta.json
 *         (written by scripts/blender/<name>.py -- that is the source of truth
 *         for how the thing looks; this script only resizes and concatenates)
 * Output: client/public/sprites/<name>.png
 *
 * WHY 2x AND NOT 1x
 * The renderer clamps zoom to [0.4, 1.8] (client/src/main.ts). Packing at the
 * logical 96x128 would visibly soften at max zoom, so frames are stored at 2x
 * (192x256) and drawn down into the logical box. Blender renders at 4x
 * (SS in the .py); the lanczos step down to 2x is what antialiases the edges.
 */

import { createRequire } from 'node:module';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const name = process.argv[2] ?? 'carousel';
const SRC = path.join(HERE, 'out', name);
const DEST_DIR = path.join(REPO, 'client', 'public', 'sprites');
const DEST = path.join(DEST_DIR, `${name}.png`);

const PACK_SCALE = 2; // see header

const meta = JSON.parse(await readFile(path.join(SRC, 'meta.json'), 'utf8'));
const [W, H] = meta.sprite;
const fw = W * PACK_SCALE;
const fh = H * PACK_SCALE;

const frames = (await readdir(SRC)).filter((f) => /^f\d+\.png$/.test(f)).sort();
if (frames.length !== meta.frames) {
  throw new Error(`meta.json says ${meta.frames} frames, found ${frames.length}`);
}

const tiles = await Promise.all(
  frames.map(async (f, i) => ({
    input: await sharp(path.join(SRC, f))
      .resize(fw, fh, { kernel: 'lanczos3' })
      .png()
      .toBuffer(),
    left: i * fw,
    top: 0,
  })),
);

await mkdir(DEST_DIR, { recursive: true });
await sharp({
  create: {
    width: fw * frames.length,
    height: fh,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(tiles)
  .png({ compressionLevel: 9, palette: false })
  .toFile(DEST);

const { size } = await sharp(DEST).metadata().then(async (m) => ({ ...m, size: (await readFile(DEST)).length }));

console.log(
  JSON.stringify(
    {
      wrote: path.relative(REPO, DEST),
      strip: [fw * frames.length, fh],
      frames: frames.length,
      frame_px: [fw, fh],
      logical_px: [W, H],
      anchor: meta.anchor,
      pack_scale: PACK_SCALE,
      bytes: size,
    },
    null,
    2,
  ),
);
