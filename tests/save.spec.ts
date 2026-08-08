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

/**
 * ARCHITECTURE.md §3.6, the half that stayed open until now: `anchorOf` was a
 * persisted copy of what `map` already says. It is now derived on load.
 *
 * The adjacent-blocks case is the one that makes this non-trivial: two 2×2
 * rides side by side cover a solid 4×2 rectangle of identical tiles, and no
 * single tile can tell you which ride it belongs to. Only the row-major scan
 * order resolves it.
 */
test('anchorOf is not persisted, and is rebuilt from the map', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__GAME__);

  // Two 2x2 haunted houses flush against each other: one 4x2 solid rectangle.
  await page.evaluate(() => {
    const S = (window as any).__GAME__.state;
    S.funds = 9_999_999;
    for (const ax of [4, 6]) {
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) S.map[ax + dx][4 + dy] = 'haunted';
      }
    }
    (window as any).__GAME__.saveGame();
  });

  const blob = await page.evaluate(() => localStorage.getItem('c2c_park_v4')!);
  expect(blob).not.toContain('anchorOf');

  await page.reload();
  await page.waitForFunction(() => !!(window as any).__GAME__);

  const anchors = await page.evaluate(() => {
    const S = (window as any).__GAME__.state;
    const at = (x: number, y: number) => {
      const a = S.anchorOf[`${x},${y}`];
      return a ? `${a.ax},${a.ay}` : 'none';
    };
    return {
      a00: at(4, 4), a10: at(5, 4), a01: at(4, 5), a11: at(5, 5),
      b00: at(6, 4), b10: at(7, 4), b01: at(6, 5), b11: at(7, 5),
    };
  });

  // Every tile of the left house points at (4,4); every tile of the right at
  // (6,4). A naive "scan left for the same type" would collapse them into one.
  expect(anchors.a00).toBe('4,4');
  expect(anchors.a10).toBe('4,4');
  expect(anchors.a01).toBe('4,4');
  expect(anchors.a11).toBe('4,4');
  expect(anchors.b00).toBe('6,4');
  expect(anchors.b10).toBe('6,4');
  expect(anchors.b01).toBe('6,4');
  expect(anchors.b11).toBe('6,4');
});
