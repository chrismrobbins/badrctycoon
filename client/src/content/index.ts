/**
 * The registry. Everything the game used to keep in parallel tables is derived
 * here from ATTRACTIONS, so there is exactly one place to edit.
 *
 * Replaces, in the monolith: BUILD_DATA, SCENERY_TYPES, RIDE_TYPES, SHOP_TYPES,
 * TYPE_LABEL, RIDE_ACCENT, NAME_POOL, MINI_COLORS, RESEARCH_ORDER, HOTKEY_TOOLS,
 * and the hand-written palette markup in index.html.
 */

import type { Attraction } from './define';
import { SCENERY } from './scenery';
import { SHOPS } from './shops';
import { RIDES } from './rides';

export type { Attraction, Category, NeedId } from './define';
export { NEEDS, NEED_BY_ID, BALLOON_BUY_CHANCE, BALLOON_HAPPINESS } from './needs';

export const ATTRACTIONS: Attraction[] = [...SCENERY, ...SHOPS, ...RIDES];

// ── Integrity, checked once at import ───────────────────────────────────────
// These used to be silent failure modes: a duplicate id would shadow, a missing
// TYPE_LABEL would render the raw id, a gap in RESEARCH_ORDER would strand a ride
// as permanently unbuildable. Now they throw at startup instead.
{
  const seen = new Set<string>();
  for (const a of ATTRACTIONS) {
    if (seen.has(a.id)) throw new Error(`[content] duplicate id "${a.id}"`);
    seen.add(a.id);
  }

  const hotkeys = ATTRACTIONS.filter((a) => a.hotkey != null).map((a) => a.hotkey!);
  if (new Set(hotkeys).size !== hotkeys.length) {
    throw new Error('[content] two attractions claim the same hotkey');
  }

  const orders = ATTRACTIONS.filter((a) => a.researchOrder != null)
    .map((a) => a.researchOrder!)
    .sort((x, y) => x - y);
  orders.forEach((o, i) => {
    if (o !== i + 1) throw new Error(`[content] researchOrder must be 1..n with no gaps; saw ${orders.join(',')}`);
  });
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** id -> attraction. Drop-in for the old BUILD_DATA. */
export const BUILD_DATA: Record<string, Attraction> = Object.fromEntries(
  ATTRACTIONS.map((a) => [a.id, a]),
);

export const byId = (id: string): Attraction | undefined => BUILD_DATA[id];

export const RIDE_TYPES = new Set(ATTRACTIONS.filter((a) => a.isRide).map((a) => a.id));
export const SHOP_TYPES = new Set(ATTRACTIONS.filter((a) => a.isShop).map((a) => a.id));
export const SCENERY_TYPES = new Set(ATTRACTIONS.filter((a) => a.isScenery).map((a) => a.id));

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ATTRACTIONS.map((a) => [a.id, a.label]),
);

export const NAME_POOL: Record<string, string[]> = Object.fromEntries(
  ATTRACTIONS.filter((a) => a.names.length).map((a) => [a.id, a.names]),
);

export const RIDE_ACCENT: Record<string, string> = Object.fromEntries(
  ATTRACTIONS.filter((a) => a.isRide).map((a) => [a.id, a.accent]),
);

/** The park gate is not an attraction but does need a pixel on the minimap. */
export const MINI_COLORS: Record<string, string> = {
  entrance: '#ef4444',
  ...Object.fromEntries(ATTRACTIONS.map((a) => [a.id, a.minimap])),
};

/** Unlock queue, in order. */
export const RESEARCH_ORDER: string[] = ATTRACTIONS
  .filter((a) => a.researchOrder != null)
  .sort((a, b) => a.researchOrder! - b.researchOrder!)
  .map((a) => a.id);

/** Available without research -- the starting set for a new park. */
export const STARTING_UNLOCKS: string[] = ATTRACTIONS
  .filter((a) => a.researchOrder == null)
  .map((a) => a.id);

/** Index 0-8 maps to keys 1-9. */
export const HOTKEY_TOOLS: (string | undefined)[] = (() => {
  const out: (string | undefined)[] = new Array(9).fill(undefined);
  for (const a of ATTRACTIONS) if (a.hotkey) out[a.hotkey - 1] = a.id;
  return out;
})();

// ── Palette ─────────────────────────────────────────────────────────────────

export interface PaletteGroup {
  heading: string | null;
  items: Attraction[];
}

/** Build-palette layout: rides and scenery first, then a Shops heading. */
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    heading: null,
    items: [...SCENERY, ...RIDES].sort((a, b) => a.cost - b.cost),
  },
  {
    heading: 'Shops & Services',
    items: [...SHOPS].sort((a, b) => a.cost - b.cost),
  },
];
