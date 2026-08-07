import { test, expect, type Page } from '@playwright/test';

/**
 * The ledger invariant.
 *
 *     funds === STARTING_FUNDS + sum(income) - sum(expense)
 *
 * The monolith broke this the first time you demolished or undid anything. Four
 * places moved `funds` directly and skipped earn()/spend(): both bulldozer
 * branches and both undo branches. The Finance tab's all-time totals then drifted
 * permanently and never reconciled again.
 *
 * This matters beyond the UI: it is one of the invariants the server checks on
 * every save (docs/API-CONTRACT.md). A client that cannot keep its own books
 * cannot have them validated.
 */

const STARTING_FUNDS = 10_000;

async function books(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__GAME__.state;
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    return {
      funds: s.funds,
      income: sum(s.ledger.income),
      expense: sum(s.ledger.expense),
      refunds: s.ledger.income.refunds,
      construction: s.ledger.expense.construction,
    };
  });
}

async function expectReconciled(page: Page) {
  const b = await books(page);
  expect(b.funds).toBe(STARTING_FUNDS + b.income - b.expense);
}

/** Place a tile by driving the tool then clicking the canvas at a screen point. */
async function build(page: Page, tool: string, dx: number, dy: number) {
  await page.locator(`.build-btn[data-act="setTool"][data-arg="${tool}"]`).click();
  const box = (await page.locator('#game-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test('the books balance on a fresh park', async ({ page }) => {
  await page.goto('/');
  await expectReconciled(page);
});

test('borrowing and repaying keeps the books balanced', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="openMgmt"][data-arg="finance"]').first().click();
  await page.getByRole('button', { name: 'Borrow $5,000' }).click();
  await page.getByRole('button', { name: 'Repay $5,000' }).click();
  await expectReconciled(page);
});

test('building then demolishing keeps the books balanced', async ({ page }) => {
  await page.goto('/');
  // Pause so the economy cannot move funds underneath the assertions.
  await page.locator('[data-act="setSpeed"][data-arg="0"]').click();

  await build(page, 'tree', -40, 10);
  const built = await books(page);
  expect(built.construction).toBeGreaterThan(0);

  await build(page, 'bulldozer', -40, 10);
  const razed = await books(page);

  // The refund is booked, not smuggled straight into funds.
  expect(razed.refunds).toBeGreaterThan(0);
  await expectReconciled(page);
});

test('undo reverses the ledger entry rather than booking a new one', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="setSpeed"][data-arg="0"]').click();

  const before = await books(page);
  await build(page, 'tree', 40, 10);
  expect((await books(page)).construction).toBeGreaterThan(before.construction);

  await page.locator('[data-act="undoLast"]').click();
  const after = await books(page);

  // Undoing a build must leave the ledger where it started -- not add an
  // offsetting income entry that inflates both totals forever.
  expect(after.construction).toBe(before.construction);
  expect(after.funds).toBe(before.funds);
  expect(after.income).toBe(before.income);
  await expectReconciled(page);
});

test('a v6 save gains the refunds bucket instead of breaking', async ({ page }) => {
  const map: (string | null)[][] = [];
  for (let x = 0; x < 15; x++) {
    map[x] = [];
    for (let y = 0; y < 15; y++) map[x][y] = x === 0 && y >= 6 && y <= 8 ? 'entrance' : null;
  }
  await page.addInitScript(
    ([key, json]) => localStorage.setItem(key as string, json as string),
    ['c2c_park_v4', JSON.stringify({
      version: 6, map, gridSize: 15, funds: 8000,
      // v6 ledgers have no `refunds` key at all.
      ledger: { income: { admission: 1, rides: 2, shops: 3, objectives: 0, loans: 0 },
                expense: { construction: 0, wages: 0, repairs: 0, interest: 0, marketing: 0, research: 0, land: 0, loanRepaid: 0 } },
      dayLedger: { income: { admission: 0, rides: 0, shops: 0, objectives: 0, loans: 0 },
                   expense: { construction: 0, wages: 0, repairs: 0, interest: 0, marketing: 0, research: 0, land: 0, loanRepaid: 0 } },
    })] as const,
  );
  await page.goto('/');

  const s = await page.evaluate(() => (window as any).__GAME__.state);
  expect(s.version).toBe(7);
  expect(s.ledger.income.refunds).toBe(0);
  expect(s.dayLedger.income.refunds).toBe(0);
  expect(s.ledger.income.admission).toBe(1);
});
