#!/usr/bin/env node
/**
 * Packs Blender-rendered frames into the sprite sheets the game loads, and
 * emits the TypeScript spec table describing them.
 *
 *   node scripts/blender/pack-strip.mjs            # all attractions
 *   node scripts/blender/pack-strip.mjs tree lamp  # just these
 *
 * Input:  scripts/blender/out/<id>/v<V>_f<F>.png + meta.json
 *         (written by scripts/blender/attractions.py, which is the source of
 *         truth for how anything looks -- this script only resizes, arranges
 *         and measures)
 * Output: client/public/sprites/<id>.png
 *         client/src/render/sprites/generated-strips.ts
 *
 * LAYOUT: columns are animation frames, rows are tileHash variants. So frame
 * f of variant v is at (f * frameW, v * frameH).
 *
 * WHY 2x: the renderer clamps zoom to [0.4, 1.8] (client/src/main.ts), so a
 * 1x sheet visibly softens when zoomed in. Blender renders at 4x (SS in
 * kit.py); the lanczos step down to 2x is what antialiases the edges.
 *
 * WHY THE CLIPPING CHECK: the frame box is set per-attraction by hand in
 * attractions.py's MANIFEST. Get it wrong and Blender silently renders a
 * carousel with its canopy sliced off -- no error, no warning, and it is
 * genuinely hard to notice at map scale. Two of nineteen attractions were
 * clipped on the first pass. This refuses to pack a sheet whose artwork
 * touches the frame edge.
 */

import { createRequire } from 'node:module';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SRC_ROOT = path.join(HERE, 'out');
const DEST_DIR = path.join(REPO, 'client', 'public', 'sprites');
const TS_OUT = path.join(REPO, 'client', 'src', 'render', 'sprites', 'generated-strips.ts');

const PACK_SCALE = 2;
const SS = 4;                       // must match kit.py
const MIN_MARGIN_PX = 1;            // at 1x; below this we call it clipped

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/** Tightest transparent margin around the artwork, in 1x px. */
async function margin(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return Infinity;    // fully transparent frame: nothing to clip
  return Math.min(minX, W - 1 - maxX, minY, H - 1 - maxY) / SS;
}

// EVERY rendered attraction, not just the ones being re-packed.
//
// The generated TS table describes the whole set, so it must be written from
// the whole set: an earlier version filtered this list by `only`, and packing
// a single sprite silently rewrote generated-strips.ts with ONE entry, which
// took the game down at boot with "no packed strip for flowerbed". Re-encoding
// is filtered below; describing is not.
const allIds = (await readdir(SRC_ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && existsSync(path.join(SRC_ROOT, d.name, 'meta.json')))
  .map((d) => d.name)
  .sort();
const repack = new Set(only.length ? only : allIds);
const ids = allIds;

await mkdir(DEST_DIR, { recursive: true });

const specs = [];
let totalBytes = 0;

for (const id of ids) {
  const dir = path.join(SRC_ROOT, id);
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const [W, H] = meta.sprite;
  const fw = W * PACK_SCALE;
  const fh = H * PACK_SCALE;

  const files = (await readdir(dir)).filter((f) => /^v\d+_f\d+\.png$/.test(f)).sort();
  const expected = meta.frames * meta.variants;
  if (files.length !== expected) {
    throw new Error(`${id}: meta says ${expected} images (${meta.frames}f x ${meta.variants}v), found ${files.length}`);
  }

  const dest = path.join(DEST_DIR, `${id}.png`);
  const doPack = repack.has(id) || !existsSync(dest);

  let worst = Infinity;
  const tiles = [];
  if (doPack) {
    for (const f of files) {
      const m = await margin(path.join(dir, f));
      if (m < worst) worst = m;
      const [, v, fr] = f.match(/^v(\d+)_f(\d+)\.png$/).map(Number);
      tiles.push({
        input: await sharp(path.join(dir, f)).resize(fw, fh, { kernel: 'lanczos3' }).png().toBuffer(),
        left: fr * fw,
        top: v * fh,
      });
    }
  }

  if (doPack && worst < MIN_MARGIN_PX) {
    throw new Error(
      `${id}: artwork touches the frame edge (margin ${worst.toFixed(1)}px at 1x). ` +
      `Raise w/h for "${id}" in scripts/blender/attractions.py MANIFEST and re-render -- ` +
      `packing this would ship a visibly sliced sprite.`,
    );
  }

  if (doPack) {
    await sharp({
    create: {
      width: fw * meta.frames,
      height: fh * meta.variants,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(tiles)
    // 256-colour palette. These are flat-shaded renders of a handful of
    // materials, so they quantise almost losslessly: measured against the
    // truecolour output, mean error is 1-2/255 and the two are
    // indistinguishable side by side, for ~25% of the bytes (2.9 MB -> 0.75 MB
    // across the set). 128 colours is NOT safe -- it visibly dithers the
    // large flat gradients on the ferris wheel deck and the ride pads.
    .png({ compressionLevel: 9, palette: true, colors: 256, effort: 10 })
    .toFile(dest);
  }

  const bytes = (await readFile(dest)).length;
  totalBytes += bytes;
  specs.push({ id, frames: meta.frames, variants: meta.variants, rot: meta.rot || 1, w: W, h: H, tiles: meta.tiles, bytes, margin: worst });
  console.log(
    `${id.padEnd(14)} ${String(meta.frames).padStart(2)}f x ${meta.variants}v${(meta.rot || 1) > 1 ? ` (${meta.rot} angles)` : ''}  ` +
    `${String(W).padStart(3)}x${String(H).padStart(3)}  ` +
    `${doPack ? `margin ${worst === Infinity ? '-' : worst.toFixed(1) + 'px'}` : 'unchanged'}  ` +
    `${(bytes / 1024).toFixed(0)} KB`,
  );
}

// ---- Emit the TS spec table -------------------------------------------
// Hand-copying these numbers into index.ts is exactly how a re-render at a
// different frame count silently starts blitting sliced-up garbage, so they
// are generated from the same data the sheets were packed with.
const rows = specs
  .map((s) => `  ${s.id}: { frames: ${s.frames}, variants: ${s.variants}, rot: ${s.rot}, w: ${s.w}, h: ${s.h}, tiles: ${s.tiles} },`)
  .join('\n');

await writeFile(
  TS_OUT,
  `// GENERATED by scripts/blender/pack-strip.mjs -- do not edit by hand.
// Regenerate with:  node scripts/blender/pack-strip.mjs
//
// Describes the sprite sheets in client/public/sprites/. Columns are
// animation frames, rows are tileHash variants; every sheet is stored at
// ${PACK_SCALE}x the logical size below. The anchor is always the centre of the
// logical box, because kit.py aims the camera at the world origin and models
// are built centred there.

export interface GeneratedStrip {
  /** Animation frames, laid out left to right. */
  frames: number;
  /**
   * Rows of the sheet, top to bottom. A row is \`variant * rot + rotation\`:
   * deterministic tileHash variants, each rendered at \`rot\` camera angles.
   */
  variants: number;
  /**
   * Camera angles baked for this sprite: 4 for anything with a front, 1 for
   * radially symmetric things that look identical from every side (rendering
   * those four times would quadruple their bytes for no visible difference).
   */
  rot: number;
  /** Logical size in world px. */
  w: number;
  h: number;
  /** Footprint in map tiles (1 = 1x1, 2 = 2x2, ...). */
  tiles: number;
}

export const PACK_SCALE = ${PACK_SCALE};

export const STRIPS: Record<string, GeneratedStrip> = {
${rows}
};
`,
  'utf8',
);

console.log(`\n${specs.length} sheets, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
console.log(`wrote ${path.relative(REPO, TS_OUT)}`);
