import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 1 guard rail.
 *
 * The port moved 4,468 lines into a module and replaced 50 inline onclick=
 * attributes with delegated data-act dispatch. A passing `tsc` proves none of
 * that works at runtime, so these tests exercise the paths most likely to have
 * broken:
 *   - module scope (the whole file runs, or nothing does)
 *   - delegation on STATIC markup (build palette, top bar)
 *   - delegation on markup renderMgmt() generates AT RUNTIME, which is the case
 *     an addEventListener-per-button conversion would have silently missed
 *   - the theme toggle, which moved here from the deleted marketing nav
 */

/** Uncaught exceptions and real console errors, ignoring CDN fetch failures. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Font Awesome / Google Fonts come from CDNs; offline runs must not fail here.
    if (/Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('boots with no uncaught errors and renders the park', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();

  // A zero-sized backing store means resize() never ran.
  const size = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);

  await expect(page.locator('#stat-funds')).toHaveText('$10,000');
  await expect(page.locator('#stat-status')).toHaveText('CLOSED');
  await expect(page.locator('#objective-list')).not.toBeEmpty();

  expect(errors).toEqual([]);
});

test('no marketing chrome survived the split', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.locator('#modal')).toHaveCount(0);        // contact / RFP form
  await expect(page.locator('#solutions-mega')).toHaveCount(0);
  await expect(page.locator('#contactForm')).toHaveCount(0);
  // No inline handlers anywhere -- they are the thing phase 1 removed.
  expect(await page.locator('[onclick]').count()).toBe(0);
});

test('delegation drives the static build palette', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  const path = page.locator('.build-btn[data-act="setTool"][data-arg="path"]');
  const tree = page.locator('.build-btn[data-act="setTool"][data-arg="tree"]');

  // A new park boots with NO tool armed -- look-and-pan mode -- so the first
  // click on the map can't lay a path you didn't ask for.
  await expect(path).not.toHaveClass(/active/);

  await path.click();
  await expect(path).toHaveClass(/active/);
  await tree.click();
  await expect(tree).toHaveClass(/active/);
  await expect(path).not.toHaveClass(/active/);

  // Clicking the armed tool again disarms it: the way back out of build mode.
  await tree.click();
  await expect(tree).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('delegation drives runtime-generated management markup', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  await page.locator('[data-act="openMgmt"][data-arg="finance"]').first().click();
  await expect(page.locator('#mgmt')).toBeVisible();

  // This button does not exist until renderMgmt() writes it into #mgmt-body.
  await page.getByRole('button', { name: 'Borrow $5,000' }).click();
  await expect(page.locator('#stat-funds')).toHaveText('$15,000');

  // Range sliders dispatch on `input`, not `click`.
  await page.locator('#price-slider').fill('25');
  await expect(page.locator('#price-label')).toHaveText('$25');

  expect(errors).toEqual([]);
});

test('every management tab renders', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await page.locator('[data-act="openMgmt"][data-arg="finance"]').first().click();

  for (const tab of ['staff', 'marketing', 'research', 'awards', 'finance']) {
    await page.locator(`.mgmt-tab[data-arg="${tab}"]`).click();
    await expect(page.locator(`.mgmt-tab[data-arg="${tab}"]`)).toHaveClass(/active/);
    await expect(page.locator('#mgmt-body')).not.toBeEmpty();
  }

  // Two elements close the modal: the backdrop and the × button. Target the
  // button -- the backdrop sits behind the panel and cannot receive the click.
  await page.locator('.mgmt-close').click();
  await expect(page.locator('#mgmt')).toBeHidden();
  expect(errors).toEqual([]);
});

test('theme toggle survived the move off the marketing nav', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const before = await html.evaluate((el) => el.classList.contains('dark'));

  await page.locator('#btn-theme').click();
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(!before);
  expect(await page.evaluate(() => localStorage.getItem('color-theme'))).toBe(before ? 'light' : 'dark');

  await page.locator('#btn-theme').click();
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(before);
});

test('top-bar controls are wired', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  await page.locator('[data-act="setSpeed"][data-arg="3"]').click();
  await expect(page.locator('#speed-3')).toHaveClass(/text-blue-500/);

  await page.locator('[data-act="toggleMinimap"]').click();
  await expect(page.locator('#minimap-wrap')).toBeHidden();
  await page.locator('[data-act="toggleMinimap"]').click();
  await expect(page.locator('#minimap-wrap')).toBeVisible();

  expect(errors).toEqual([]);
});

test('every data-act in the DOM has a handler', async ({ page }) => {
  // Guards the conversion: a typo'd data-act would warn at click time only.
  // main.ts console.warn()s on an unknown action, so drive them all and watch.
  const unhandled: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().includes('[actions] no handler')) unhandled.push(m.text());
  });
  await page.goto('/');

  const acts = await page.locator('[data-act]').evaluateAll((els) =>
    [...new Set(els.map((e) => (e as HTMLElement).dataset.act!))]
  );
  expect(acts.length).toBeGreaterThan(10);

  // __ACTIONS__ is already an array of handler names (dev-only hook in main.ts).
  const known: string[] = await page.evaluate(() => (window as any).__ACTIONS__ ?? []);
  expect(known.length).toBeGreaterThan(10);
  expect(acts.filter((a) => !known.includes(a)).sort()).toEqual([]);
  expect(unhandled).toEqual([]);
});
