import { test, expect } from '@playwright/test';
import {
  ATTRACTIONS, BUILD_DATA, RIDE_TYPES, SHOP_TYPES, SCENERY_TYPES,
  TYPE_LABEL, NAME_POOL, RIDE_ACCENT, MINI_COLORS, RESEARCH_ORDER,
  STARTING_UNLOCKS, HOTKEY_TOOLS,
} from '../client/src/content';
import { NEEDS } from '../client/src/content/needs';

/**
 * Phase 3 equivalence.
 *
 * content/ replaced nine hand-synced lookup tables. These tests pin the derived
 * values against what the monolith hardcoded, so the refactor is provably a
 * restructuring and not a rebalance. They import the registry directly -- it is
 * pure data with no canvas or DOM dependency, which is also what lets the server
 * import it for save validation.
 */

// Verbatim from legacy/park-builder.html.
const LEGACY_BUILD_DATA: Record<string, Record<string, number>> = {
  path:         { cost: 10,    rating: 1,   size: 1, sceneryBonus: 0,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  flowerbed:    { cost: 25,    rating: 2,   size: 1, sceneryBonus: 3,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  trashcan:     { cost: 30,    rating: 1,   size: 1, sceneryBonus: 1,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  bench:        { cost: 45,    rating: 3,   size: 1, sceneryBonus: 2,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  lamp:         { cost: 40,    rating: 3,   size: 1, sceneryBonus: 2,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 8 },
  tree:         { cost: 50,    rating: 5,   size: 1, sceneryBonus: 4,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  fountain:     { cost: 150,   rating: 15,  size: 1, sceneryBonus: 10, capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0 },
  balloonstand: { cost: 150,   rating: 15,  size: 1, sceneryBonus: 0,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0, price: 4 },
  restroom:     { cost: 200,   rating: 10,  size: 1, sceneryBonus: 0,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0, price: 3 },
  drinkstall:   { cost: 250,   rating: 20,  size: 1, sceneryBonus: 0,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0, price: 5 },
  foodstall:    { cost: 300,   rating: 25,  size: 1, sceneryBonus: 0,  capacity: 0,  cycleTime: 0,   excitement: 0,   nightBonus: 0, price: 8 },
  carousel:     { cost: 800,   rating: 50,  size: 1, sceneryBonus: 0,  capacity: 6,  cycleTime: 3,   excitement: 20,  nightBonus: 0 },
  teacups:      { cost: 900,   rating: 60,  size: 1, sceneryBonus: 0,  capacity: 8,  cycleTime: 2.5, excitement: 25,  nightBonus: 0 },
  bumper:       { cost: 1200,  rating: 70,  size: 1, sceneryBonus: 0,  capacity: 10, cycleTime: 3,   excitement: 35,  nightBonus: 0 },
  droptower:    { cost: 1500,  rating: 100, size: 1, sceneryBonus: 0,  capacity: 4,  cycleTime: 4,   excitement: 60,  nightBonus: 0 },
  ship:         { cost: 1800,  rating: 120, size: 2, sceneryBonus: 0,  capacity: 12, cycleTime: 3.5, excitement: 50,  nightBonus: 0 },
  haunted:      { cost: 2000,  rating: 150, size: 2, sceneryBonus: 0,  capacity: 6,  cycleTime: 5,   excitement: 70,  nightBonus: 30 },
  gokarts:      { cost: 2200,  rating: 180, size: 2, sceneryBonus: 0,  capacity: 8,  cycleTime: 4,   excitement: 55,  nightBonus: 0 },
  ferriswheel:  { cost: 2500,  rating: 200, size: 2, sceneryBonus: 0,  capacity: 16, cycleTime: 4,   excitement: 45,  nightBonus: 0 },
  coaster:      { cost: 4000,  rating: 300, size: 2, sceneryBonus: 0,  capacity: 8,  cycleTime: 5,   excitement: 90,  nightBonus: 0 },
  megacoaster:  { cost: 12000, rating: 800, size: 4, sceneryBonus: 0,  capacity: 24, cycleTime: 6,   excitement: 150, nightBonus: 20 },
};

test('every attraction has identical stats to the monolith', () => {
  expect(Object.keys(BUILD_DATA).sort()).toEqual(Object.keys(LEGACY_BUILD_DATA).sort());
  for (const [id, want] of Object.entries(LEGACY_BUILD_DATA)) {
    const got = BUILD_DATA[id] as unknown as Record<string, number>;
    for (const [field, value] of Object.entries(want)) {
      expect(`${id}.${field}=${got[field]}`).toBe(`${id}.${field}=${value}`);
    }
  }
});

test('category sets match', () => {
  expect([...RIDE_TYPES].sort()).toEqual(
    ['bumper', 'carousel', 'coaster', 'droptower', 'ferriswheel', 'gokarts', 'haunted', 'megacoaster', 'ship', 'teacups'],
  );
  expect([...SHOP_TYPES].sort()).toEqual(['balloonstand', 'drinkstall', 'foodstall', 'restroom']);
  // 'path' is its own category and was never in SCENERY_TYPES.
  expect([...SCENERY_TYPES].sort()).toEqual(['bench', 'flowerbed', 'fountain', 'lamp', 'trashcan', 'tree']);
  expect(SCENERY_TYPES.has('path')).toBe(false);
});

test('research queue and starting unlocks match', () => {
  expect(RESEARCH_ORDER).toEqual([
    'teacups', 'balloonstand', 'bumper', 'droptower', 'ship',
    'ferriswheel', 'haunted', 'gokarts', 'coaster', 'megacoaster',
  ]);
  expect(STARTING_UNLOCKS.sort()).toEqual([
    'bench', 'carousel', 'drinkstall', 'flowerbed', 'foodstall', 'fountain',
    'lamp', 'path', 'restroom', 'trashcan', 'tree',
  ]);
  // Together they must cover everything, or a ride is unbuildable forever.
  expect([...RESEARCH_ORDER, ...STARTING_UNLOCKS].sort()).toEqual(Object.keys(BUILD_DATA).sort());
});

test('hotkeys 1-9 map to the same tools', () => {
  expect(HOTKEY_TOOLS).toEqual([
    'path', 'trashcan', 'bench', 'lamp', 'tree', 'fountain', 'foodstall', 'drinkstall', 'restroom',
  ]);
});

test('colours match', () => {
  expect(RIDE_ACCENT.ship).toBe('#f59e0b');
  expect(RIDE_ACCENT.haunted).toBe('#8b5cf6');
  expect(RIDE_ACCENT.ferriswheel).toBe('#3b82f6');
  expect(RIDE_ACCENT.coaster).toBe('#ef4444');
  expect(RIDE_ACCENT.gokarts).toBe('#22c55e');
  expect(RIDE_ACCENT.megacoaster).toBe('#f43f5e');
  // Rides with no explicit accent kept the minimap's old '#a855f7' fallback.
  expect(RIDE_ACCENT.carousel).toBe('#a855f7');

  expect(MINI_COLORS.entrance).toBe('#ef4444');
  expect(MINI_COLORS.path).toBe('#94a3b8');
  expect(MINI_COLORS.tree).toBe('#15803d');
  expect(MINI_COLORS.balloonstand).toBe('#f43f5e');
});

test('every ride and shop has a name pool, and labels are complete', () => {
  for (const a of ATTRACTIONS) {
    expect(TYPE_LABEL[a.id], `label for ${a.id}`).toBeTruthy();
    if (a.isRide || a.isShop) {
      expect(NAME_POOL[a.id]?.length, `names for ${a.id}`).toBeGreaterThan(0);
    }
  }
  expect(NAME_POOL.coaster).toContain('The Rollback');
  expect(NAME_POOL.megacoaster).toContain('The Go-Live');
});

test('every shop serves a declared need, and every need is servable', () => {
  const served = new Set(ATTRACTIONS.filter((a) => a.isShop).map((a) => a.shop));
  for (const need of NEEDS) {
    expect(served.has(need.id), `no shop satisfies "${need.id}"`).toBe(true);
  }
  for (const a of ATTRACTIONS.filter((x) => x.isShop)) {
    expect(a.price, `${a.id} needs a price`).toBeGreaterThan(0);
  }
});

test('defineAttraction rejects malformed content at import time', async () => {
  const { defineAttraction } = await import('../client/src/content/define');
  const ui = { icon: 'fa-x', iconBg: '', iconFg: '' };
  expect(() => defineAttraction({ id: 'Bad Id', label: 'x', category: 'scenery', cost: 1, rating: 1, ui })).toThrow(/bad id/);
  expect(() => defineAttraction({ id: 'noshop', label: 'x', category: 'shop', cost: 1, rating: 1, ui })).toThrow(/which need/);
  expect(() => defineAttraction({ id: 'noseats', label: 'x', category: 'ride', cost: 1, rating: 1, ui })).toThrow(/capacity/);
});
