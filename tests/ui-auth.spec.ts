import { test, expect, type Page } from '@playwright/test';

/**
 * Step 8 of docs/BACKEND-HANDOFF.md's build order, driven through the real
 * DOM rather than by calling ui/auth.ts's exports directly -- the point of
 * this file is proving the actual click path works, the same bar
 * tests/smoke.spec.ts holds the rest of the UI to.
 *
 * Skips cleanly (not a failure) when no server is reachable, same pattern as
 * tests/server-integration.spec.ts, so `npm test` on a fresh clone stays
 * green without one running.
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8787';
const PASSWORD = 'integration-test-password';

let serverAvailable = false;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

function uniqueUsername(): string {
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function register(page: Page, username: string) {
  await page.locator('[data-act="openAccount"]').click();
  await page.locator('[data-authact="mode-register"]').click();
  await page.locator('form[data-form="register"] [name="username"]').fill(username);
  await page.locator('form[data-form="register"] [name="password"]').fill(PASSWORD);
  await page.locator('form[data-form="register"] button[type="submit"]').click();
}

test('the account panel opens and closes without a server, and the park stays playable', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  await page.locator('[data-act="openAccount"]').click();
  await expect(page.locator('#account form[data-form="login"]')).toBeVisible();
  await page.locator('#account .acct-close').click();
  await expect(page.locator('#account')).toBeHidden();

  // The rest of the game never noticed.
  await page.locator('[data-act="setTool"][data-arg="tree"]').first().click();
  expect(errors).toEqual([]);
});

test.describe('with a server', () => {
  test('register, save the current park to a new slot, and it shows as synced', async ({ page }) => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);
    const errors = watchForErrors(page);
    await page.goto('/');
    await register(page, uniqueUsername());

    await expect(page.locator('#account')).toContainText('No saved parks yet.');
    await page.locator('form[data-form="new-slot"] [name="parkName"]').fill('UI Test Park');
    await page.locator('form[data-form="new-slot"] button[type="submit"]').click();

    await expect(page.locator('#account')).toContainText('Synced', { timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test('switching park returns to the picker, and loading a slot re-attaches it', async ({ page }) => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);
    page.on('dialog', (d) => void d.accept());
    await page.goto('/');
    await register(page, uniqueUsername());

    await page.locator('form[data-form="new-slot"] [name="parkName"]').fill('Switchable Park');
    await page.locator('form[data-form="new-slot"] button[type="submit"]').click();
    await expect(page.locator('#account')).toContainText('Synced', { timeout: 10_000 });

    await page.locator('[data-authact="switch-park"]').click();
    await expect(page.locator('#account')).toContainText('Switchable Park');

    await page.locator('[data-authact="load-slot"]').click();
    await expect(page.locator('#account')).toContainText('Synced', { timeout: 10_000 });
  });

  test('two devices on the same account: the second save conflicts, and "use theirs" resolves it', async ({ browser }) => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);
    const username = uniqueUsername();

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto('/');
    await register(pageA, username);
    await pageA.locator('form[data-form="new-slot"] [name="parkName"]').fill('Device A Park');
    await pageA.locator('form[data-form="new-slot"] button[type="submit"]').click();
    await expect(pageA.locator('#account')).toContainText('Synced', { timeout: 10_000 });

    // Device B: a second, independent browser context -- its own cookie jar,
    // logged into the same account, loading the same slot A just created.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    pageB.on('dialog', (d) => void d.accept());
    await pageB.goto('/');
    await pageB.locator('[data-act="openAccount"]').click();
    await pageB.locator('form[data-form="login"] [name="username"]').fill(username);
    await pageB.locator('form[data-form="login"] [name="password"]').fill(PASSWORD);
    await pageB.locator('form[data-form="login"] button[type="submit"]').click();
    await pageB.locator('[data-authact="load-slot"]').click();
    await expect(pageB.locator('#account')).toContainText('Synced', { timeout: 10_000 });

    // A saves again first -- moves the slot's revision without B knowing.
    await pageA.locator('[data-authact="save-now"]').click();
    await expect(pageA.locator('#account')).toContainText('Synced', { timeout: 10_000 });

    // B saves against its now-stale revision -- the conflict dialog, not an error.
    await pageB.locator('[data-authact="save-now"]').click();
    await expect(pageB.locator('#account')).toContainText('was also saved on another device', { timeout: 10_000 });
    await pageB.locator('[data-authact="take-remote"]').click();
    await expect(pageB.locator('#account')).toContainText('Synced', { timeout: 10_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
