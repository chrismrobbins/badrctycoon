import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2 guard rail: the save format.
 *
 * The monolith's loadGame() opened with `if (!s || s.v !== 5) return false;` --
 * any save that was not exactly v5 was discarded, a new park was created over it,
 * and the 12-second autosave overwrote the original moments later. Bumping the
 * version deleted every player's park.
 *
 * These tests exist so that can never ship again.
 */

const SAVE_KEY = 'c2c_park_v4';

/** A 15x15 grid with the fixed 3-tile entrance gate on the west edge. */
function blankMap() {
  const m: (string | null)[][] = [];
  for (let x = 0; x < 15; x++) {
    m[x] = [];
    for (let y = 0; y < 15; y++) m[x][y] = x === 0 && y >= 6 && y <= 8 ? 'entrance' : null;
  }
  return m;
}

async function seedSave(page: Page, payload: unknown) {
  await page.addInitScript(
    ([key, json]) => localStorage.setItem(key as string, json as string),
    [SAVE_KEY, JSON.stringify(payload)] as const,
  );
}

async function state(page: Page) {
  return page.evaluate(() => (window as any).__GAME__.state);
}

// No localStorage.clear() hook here on purpose: addInitScript re-runs on every
// navigation, so it would wipe the save during the very reload these tests are
// checking. Playwright gives each test a fresh context, so storage starts empty.

test('a park survives a reload', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-act="openMgmt"][data-arg="finance"]').first().click();
  await page.getByRole('button', { name: 'Borrow $5,000' }).click();
  await expect(page.locator('#stat-funds')).toHaveText('$15,000');
  await page.locator('.mgmt-close').click();

  await page.evaluate(() => (window as any).__GAME__.saveGame());
  await page.reload();

  await expect(page.locator('#stat-funds')).toHaveText('$15,000');
  const s = await state(page);
  expect(s.loanBalance).toBe(5000);
  expect(s.ledger.income.loans).toBe(5000);
});

test('the whole state object round-trips, not a hand-picked subset', async ({ page }) => {
  await page.goto('/');

  // Fields the old saveGame() silently dropped.
  await page.evaluate(() => {
    const g = (window as any).__GAME__;
    g.state.parkHappiness = 73;
    g.state.weather = 'rain';
    g.state.isParkOpen = true;
    g.state.guests = 41;
    g.saveGame();
  });
  await page.reload();

  const s = await state(page);
  expect(s.parkHappiness).toBe(73);
  expect(s.weather).toBe('rain');
  expect(s.isParkOpen).toBe(true);
  expect(s.guests).toBe(41);

  // cleanliness is intentionally NOT round-tripped: recomputeCleanliness()
  // rederives it from litter-per-path at boot, so the stored value is a cache.
  expect(s.cleanliness).toBe(100);
});

test('a legacy v5 save is migrated, not discarded', async ({ page }) => {
  await seedSave(page, {
    v: 5,
    map: blankMap(),
    gridSize: 15,
    funds: 4242,
    rating: 137,
    dayCount: 9,
    gameTime: 14.5,
    builtValue: 900,
    shopSales: 12,
    objectiveIndex: 2,
    admissionPrice: 18,
    loanBalance: 3000,
    landPurchased: 1,
    lastAwardDay: 6,
    awardsWon: [{ id: 'clean', day: 4 }],
    rideNames: { '3,3': 'The Rollback' },
    litter: { '2,2': 2 },
    research: { unlocked: ['path', 'tree'], progress: 55, budget: 125 },
    marketing: { key: 'radio', daysLeft: 2 },
    rideMeta: { '3,3': { riders: 88, earned: 704, breakdowns: 3 } },
    staff: [{ kind: 'janitor', name: 'Rosa', x: 1, y: 7 }],
  });
  await page.goto('/');

  const s = await state(page);
  expect(s.version).toBe(8);
  expect(s.funds).toBe(4242);
  // `rating` is no longer stored -- it is recomputed as (map ratings + award
  // ratings), so the legacy save's possibly-drifted 137 is discarded on purpose.
  expect(s.rating).toBeUndefined();
  expect(s.dayCount).toBe(9);
  expect(s.admissionPrice).toBe(18);
  expect(s.loanBalance).toBe(3000);
  expect(s.research.budget).toBe(125);
  expect(s.marketing.key).toBe('radio');
  expect(s.rideNames['3,3']).toBe('The Rollback');
  expect(s.litter['2,2']).toBe(2);
  expect(s.awardsWon).toHaveLength(1);

  // Staff come back walkable, not as the bare {kind,name,x,y} the save holds.
  // Don't assert progress === 1: they start walking immediately after hydration.
  expect(s.staff).toHaveLength(1);
  expect(s.staff[0].name).toBe('Rosa');
  expect(s.staff[0].kind).toBe('janitor');
  expect(typeof s.staff[0].speed).toBe('number');
  expect(typeof s.staff[0].tx).toBe('number');

  await expect(page.locator('#stat-funds')).toHaveText('$4,242');
  await expect(page.locator('#stat-day')).toHaveText('Day 9');
  // Empty map + the one award in the save ('clean', 40) = 40, derived.
  await expect(page.locator('#stat-rating')).toHaveText('40');
});

test('an unrecognised older save is recovered, not wiped', async ({ page }) => {
  // The exact case the old version gate destroyed.
  await seedSave(page, { v: 3, map: blankMap(), gridSize: 15, funds: 777, rating: 42 });
  await page.goto('/');

  const s = await state(page);
  expect(s.funds).toBe(777);
  expect(s.rating).toBeUndefined();   // derived, not stored
  expect(s.version).toBe(8);
  await expect(page.locator('#stat-funds')).toHaveText('$777');
  await expect(page.locator('#stat-rating')).toHaveText('0');   // empty map, no awards
});

test('a corrupt save falls back to a new park instead of throwing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(
    ([key]) => localStorage.setItem(key as string, '{"v":5,"map":[[[['),
    [SAVE_KEY] as const,
  );
  await page.goto('/');

  await expect(page.locator('#stat-funds')).toHaveText('$10,000');
  expect(errors).toEqual([]);
});

test('rideQueues are reconciled against the map on load', async ({ page }) => {
  // A queue record whose ride no longer exists must not survive the load.
  await seedSave(page, {
    v: 5,
    map: blankMap(),
    gridSize: 15,
    funds: 5000,
    rideMeta: { '9,9': { riders: 10, earned: 80, breakdowns: 1 } },
  });
  await page.goto('/');

  const s = await state(page);
  expect(Object.keys(s.rideQueues)).toEqual([]);
});
