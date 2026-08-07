import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 5 guard rail: the game loop.
 *
 * The monolith ran three clocks. The economy was a 1.5s setInterval, but guests
 * and staff updated inside requestAnimationFrame, which produced two bugs:
 *
 *   1. setSpeed(0) never stopped guests. `visualGuests.forEach(g => g.update())`
 *      had no gameSpeed guard, so a "paused" park kept walking, littering, and
 *      calling earn(price, 'shops').
 *   2. The simulation ran at the display refresh rate -- guests moved 2.4x
 *      faster on a 144Hz monitor -- while the economy did not, so the balance
 *      of the game changed with your hardware.
 */

const game = (page: Page) => page.evaluate(() => (window as any).__GAME__);

async function simClock(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__GAME__.simClock);
}

async function setSpeed(page: Page, n: 0 | 1 | 3) {
  await page.locator(`[data-act="setSpeed"][data-arg="${n}"]`).click();
}

test('pausing freezes simulated time', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 0);

  const before = await simClock(page);
  await page.waitForTimeout(600);
  const after = await simClock(page);

  expect(after).toBe(before);
});

test('playing advances simulated time at roughly wall-clock rate', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 1);

  const before = await simClock(page);
  await page.waitForTimeout(700);
  const elapsed = (await simClock(page)) - before;

  // Generous bounds: the point is that it tracks wall time, not that it is exact.
  expect(elapsed).toBeGreaterThan(300);
  expect(elapsed).toBeLessThan(1400);
});

test('fast-forward advances time faster than normal speed', async ({ page }) => {
  await page.goto('/');

  await setSpeed(page, 1);
  let t = await simClock(page);
  await page.waitForTimeout(600);
  const atNormal = (await simClock(page)) - t;

  await setSpeed(page, 3);
  t = await simClock(page);
  await page.waitForTimeout(600);
  const atFast = (await simClock(page)) - t;

  expect(atFast).toBeGreaterThan(atNormal * 1.8);
});

test('guests do not move while paused', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 0);

  // Drop a guest on the entrance tile directly -- building a path to attract one
  // would need canvas clicks with isometric hit-testing.
  const start = await page.evaluate(() => {
    const g = (window as any).__GAME__;
    const guest = new g.Guest(0, 7);
    g.state.visualGuests.push(guest);
    return { x: guest.x, y: guest.y, progress: guest.progress, hunger: guest.hunger };
  });

  await page.waitForTimeout(600);

  const now = await page.evaluate(() => {
    const guest = (window as any).__GAME__.state.visualGuests[0];
    return { x: guest.x, y: guest.y, progress: guest.progress, hunger: guest.hunger };
  });

  expect(now).toEqual(start);
});

test('guests do move once unpaused', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 1);

  const start = await page.evaluate(() => {
    const g = (window as any).__GAME__;
    const guest = new g.Guest(0, 7);
    g.state.visualGuests.push(guest);
    return guest.hunger;
  });

  await page.waitForTimeout(600);

  const now = await page.evaluate(() => (window as any).__GAME__.state.visualGuests[0].hunger);
  expect(now).toBeGreaterThan(start);
});

test('a paused park earns nothing', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 0);

  const before = await page.evaluate(() => {
    const s = (window as any).__GAME__.state;
    return { funds: s.funds, shops: s.ledger.income.shops, day: s.dayCount, time: s.gameTime };
  });

  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => {
    const s = (window as any).__GAME__.state;
    return { funds: s.funds, shops: s.ledger.income.shops, day: s.dayCount, time: s.gameTime };
  });

  expect(after).toEqual(before);
});

test('the economy still runs when unpaused', async ({ page }) => {
  await page.goto('/');
  await setSpeed(page, 3);

  const before = await page.evaluate(() => (window as any).__GAME__.state.gameTime);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => (window as any).__GAME__.state.gameTime);

  expect(after).not.toBe(before);
});

test('simulated time never outpaces wall-clock time at normal speed', async ({ page, context }) => {
  // The MAX_CATCHUP_MS clamp exists so a tab that stopped getting frames replays
  // a quarter-second on return, not the whole gap. Headless Chromium will not
  // reliably suspend rAF on request, so rather than fake the suspension this
  // asserts the invariant the clamp protects: sim time can fall behind wall time,
  // but must never run ahead of it.
  await page.goto('/');
  await setSpeed(page, 1);

  const t0 = { sim: await simClock(page), wall: Date.now() };

  const other = await context.newPage();
  await other.goto('about:blank');
  await page.waitForTimeout(1200);
  await other.close();
  await page.bringToFront();
  await page.waitForTimeout(200);

  const simElapsed = (await simClock(page)) - t0.sim;
  const wallElapsed = Date.now() - t0.wall;

  expect(simElapsed).toBeLessThanOrEqual(wallElapsed + 100);
});
