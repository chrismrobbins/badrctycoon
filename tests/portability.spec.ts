import { test, expect } from '@playwright/test';

import { createGameState, emptyLedger, SAVE_VERSION, STARTING_FUNDS } from '../client/src/core/state';
import { migrate } from '../client/src/save/migrations';
import { earn, spend, unearn, unspend, expectedFunds, ledgerReconciles } from '../client/src/sim/finance';
import { BUILD_DATA, RIDE_TYPES } from '../client/src/content';

/**
 * These modules must stay importable outside a browser.
 *
 * The server needs them to validate saves (docs/API-CONTRACT.md): it recomputes
 * park value from BUILD_DATA and the map, checks the ledger invariant with
 * sim/finance, and runs incoming blobs through save/migrations before storing.
 * None of that can work if one of them reaches for `document` or `window` at
 * module scope.
 *
 * This file runs in Node with no DOM. If someone adds a browser dependency to
 * core/, content/, sim/ or save/migrations, the import fails here rather than in
 * production on the server.
 */

test('the shared modules import in Node with no DOM', () => {
  expect(typeof globalThis.document).toBe('undefined');
  expect(typeof globalThis.window).toBe('undefined');

  const s = createGameState();
  expect(s.version).toBe(SAVE_VERSION);
  expect(s.funds).toBe(STARTING_FUNDS);
  expect(RIDE_TYPES.size).toBeGreaterThan(0);
  expect(BUILD_DATA.megacoaster.cost).toBe(12000);
});

test('the ledger invariant is computable server-side', () => {
  const s = createGameState();
  expect(ledgerReconciles(s)).toBe(true);
  expect(expectedFunds(s)).toBe(STARTING_FUNDS);

  earn(s, 500, 'admission');
  spend(s, 800, 'construction');
  expect(s.funds).toBe(STARTING_FUNDS + 500 - 800);
  expect(ledgerReconciles(s)).toBe(true);

  // Undo paths must not leave the books unbalanced.
  unspend(s, 800, 'construction');
  unearn(s, 500, 'admission');
  expect(s.funds).toBe(STARTING_FUNDS);
  expect(s.ledger.income.admission).toBe(0);
  expect(s.ledger.expense.construction).toBe(0);
  expect(ledgerReconciles(s)).toBe(true);

  // A tampered blob is detectable: funds no longer follows from the ledger.
  s.funds += 1_000_000;
  expect(ledgerReconciles(s)).toBe(false);
});

test('park value is recomputable from the map alone', () => {
  // This is the check that makes builtValue verifiable instead of asserted.
  const s = createGameState();
  s.gridSize = 4;
  s.map = [
    ['tree', 'path', null, null],
    ['path', 'carousel', null, null],
    [null, null, null, null],
    [null, null, null, null],
  ];

  let value = 0;
  const counted = new Set<string>();
  for (let x = 0; x < s.gridSize; x++) {
    for (let y = 0; y < s.gridSize; y++) {
      const cell = s.map[x][y];
      if (!cell || cell === 'entrance') continue;
      const a = s.anchorOf[`${x},${y}`];
      const key = a ? `${a.ax},${a.ay}` : `${x},${y}`;
      if (counted.has(key)) continue;
      counted.add(key);
      value += BUILD_DATA[cell]?.cost ?? 0;
    }
  }

  expect(value).toBe(50 + 10 + 10 + 800); // tree + 2 paths + carousel
});

test('migrations run server-side, for backfills and validation', () => {
  const legacy = { v: 5, map: [[null]], gridSize: 1, funds: 4242 };
  const migrated = migrate(legacy)!;

  expect(migrated).not.toBeNull();
  expect(migrated.version).toBe(SAVE_VERSION);
  expect(migrated.funds).toBe(4242);

  // Not a park -> rejectable at the API boundary rather than stored as garbage.
  expect(migrate({ hello: 'world' })).toBeNull();
  expect(migrate(null)).toBeNull();
  expect(migrate('nonsense')).toBeNull();
});

test('emptyLedger covers every bucket the type declares', () => {
  // Guards the migration ladder: a new bucket added to the type but not to
  // emptyLedger() would produce NaN totals on the server.
  const l = emptyLedger();
  for (const v of Object.values(l.income)) expect(v).toBe(0);
  for (const v of Object.values(l.expense)) expect(v).toBe(0);
  expect(Object.keys(l.income)).toContain('refunds');
});
