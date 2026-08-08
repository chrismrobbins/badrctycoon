import { test, expect } from '@playwright/test';
import { STRIPS, PACK_SCALE } from '../client/src/render/sprites/generated-strips';

/**
 * Guard for the pre-rendered sprite pipeline (render/atlas.ts).
 *
 * A sheet's layout is described in two places: generated-strips.ts (which
 * pack-strip.mjs writes) and the PNG itself. Nothing forces them to agree at
 * runtime -- re-render with a different frame count, forget to re-pack, and
 * atlas.ts blits sliced-up garbage at exactly the right size. That is the
 * kind of bug a screenshot test sails past and a player notices weeks later.
 *
 * Importing the generated table rather than restating it is the point: if
 * pack-strip.mjs changes a number, this test changes with it, and only the
 * PNG can be out of step.
 */

const ids = Object.keys(STRIPS);

test('the generated strip table is not empty', () => {
  // A pack-strip.mjs run that produced nothing would otherwise make every
  // test below vacuously pass.
  expect(ids.length).toBeGreaterThan(15);
});

for (const id of ids) {
  const s = STRIPS[id];
  test(`${id} sheet matches its generated spec`, async ({ page }) => {
    await page.goto('/');
    const dims = await page.evaluate(
      (src) =>
        new Promise<{ w: number; h: number } | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = src;
        }),
      `/sprites/${id}.png`,
    );

    expect(dims, `/sprites/${id}.png must be served`).not.toBeNull();
    expect(dims!.w, `${id}: ${s.frames} frames x ${s.w}px x ${PACK_SCALE}`).toBe(s.frames * s.w * PACK_SCALE);
    expect(dims!.h, `${id}: ${s.variants} variants x ${s.h}px x ${PACK_SCALE}`).toBe(s.variants * s.h * PACK_SCALE);
  });
}
