import { test, expect } from '@playwright/test';

/**
 * Guard for the pre-rendered sprite pipeline (render/atlas.ts).
 *
 * The strip's layout is described twice: once in the loadStrip() call in
 * render/sprites/index.ts, and once implicitly by the PNG that
 * scripts/blender/pack-strip.mjs produced. Nothing forces those to agree --
 * re-render with a different FRAMES or SPRITE_W in the .py, forget to update
 * the spec, and the game silently blits sliced-up garbage at the right size,
 * which is exactly the kind of bug a screenshot test misses and a human
 * notices three weeks later.
 *
 * This asserts the two descriptions still match.
 */

// Mirrors the loadStrip() spec in client/src/render/sprites/index.ts.
const STRIPS = [{ name: 'carousel', frames: 16, w: 96, h: 128, packScale: 2 }];

for (const s of STRIPS) {
  test(`${s.name} strip matches its loadStrip() spec`, async ({ page }) => {
    await page.goto('/');
    const dims = await page.evaluate(
      (src) =>
        new Promise<{ w: number; h: number } | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = src;
        }),
      `/sprites/${s.name}.png`,
    );

    expect(dims, `/sprites/${s.name}.png must be served`).not.toBeNull();
    expect(dims!.w).toBe(s.frames * s.w * s.packScale);
    expect(dims!.h).toBe(s.h * s.packScale);
  });
}
