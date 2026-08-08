import { test, expect } from '@playwright/test';
test('drag paints with a tool, pans without one', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__GAME__);
  await page.evaluate(() => { (window as any).__GAME__.state.funds = 9_999_999; });
  const canvas = page.locator('#game-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // --- no tool armed: drag must MOVE the view and place nothing ---
  const before = await page.evaluate(() => {
    const S = (window as any).__GAME__.state;
    return S.map.flat().filter(Boolean).length;
  });
  const shotA = await canvas.screenshot();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx - 160, cy - 60, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPan = await page.evaluate(() => {
    const S = (window as any).__GAME__.state;
    return S.map.flat().filter(Boolean).length;
  });
  const shotB = await canvas.screenshot();
  expect(afterPan, 'no tool: dragging must not build').toBe(before);
  expect(Buffer.compare(shotA, shotB) !== 0, 'no tool: dragging must move the view').toBe(true);

  // --- tool armed: drag must lay a RUN of tiles ---
  await page.locator('.build-btn[data-act="setTool"][data-arg="path"]').click();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 70, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPaint = await page.evaluate(() => {
    const S = (window as any).__GAME__.state;
    return S.map.flat().filter((c: string) => c === 'path').length;
  });
  expect(afterPaint, 'tool armed: dragging must place a run').toBeGreaterThan(2);
});
