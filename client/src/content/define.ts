/**
 * One declaration per buildable thing.
 *
 * Phase 3 of the port. Before this, a single ride was described by eight parallel
 * lookup tables kept in sync by hand -- BUILD_DATA, RIDE_TYPES, SHOP_TYPES,
 * SCENERY_TYPES, TYPE_LABEL, RIDE_ACCENT, NAME_POOL, MINI_COLORS -- plus
 * RESEARCH_ORDER, HOTKEY_TOOLS, a hand-written palette button, and two `else if`
 * chains in the renderer. Ten edit sites, none of them enforced: a missing
 * TYPE_LABEL just degraded to the raw id at runtime.
 *
 * Now everything derives from this one array (see index.ts), and
 * defineAttraction() fills every field, so "forgot to add it to table 7" is not a
 * failure mode that exists any more.
 *
 * Deliberately data-only: no draw functions, no DOM. The renderer maps id ->
 * sprite separately (render/sprites.ts) so this module stays importable by a
 * headless simulation -- which the server needs for save validation.
 */

/** A guest need a shop can satisfy. Adding one here plus a shop that declares it
 *  is all it takes; the guest AI reads this rather than hardcoding a chain. */
export type NeedId = 'hunger' | 'thirst' | 'bladder' | 'balloon';

export type Category = 'path' | 'scenery' | 'ride' | 'shop';

export interface PaletteHints {
  /** Font Awesome class, e.g. 'fa-roller-coaster'. */
  icon: string;
  /** Short name for the palette button when the full label is too long. */
  short?: string;
  /** Tailwind classes for the icon bubble. */
  iconBg: string;
  iconFg: string;
  /** Full-width palette button. */
  span?: boolean;
  /** Small print under the cost. */
  note?: string;
}

export interface AttractionInput {
  id: string;
  label: string;
  category: Category;
  cost: number;
  rating: number;
  /** NxN footprint. */
  size?: 1 | 2 | 4;

  // Scenery
  sceneryBonus?: number;
  /** Extra excitement contributed to nearby rides after dark (lamp, haunted…). */
  nightBonus?: number;

  // Ride
  capacity?: number;
  cycleTime?: number;
  excitement?: number;

  // Shop
  shop?: NeedId;
  price?: number;

  /** Joke names assigned on construction; the player can rename. */
  names?: string[];
  /** Position in the research queue. Absent = unlocked from the start. */
  researchOrder?: number;
  /** 1-9 palette hotkey. */
  hotkey?: number;
  /** Minimap pixel colour. Rides fall back to `accent`. */
  minimap?: string;
  /** Pad border colour for multi-tile rides. */
  accent?: string;

  ui: PaletteHints;
}

/** Every field present, every time. */
export interface Attraction extends Required<Omit<AttractionInput, 'shop' | 'researchOrder' | 'hotkey' | 'names' | 'ui' | 'minimap' | 'accent'>> {
  shop: NeedId | null;
  researchOrder: number | null;
  hotkey: number | null;
  names: string[];
  minimap: string;
  accent: string;
  ui: Required<Pick<PaletteHints, 'icon' | 'iconBg' | 'iconFg'>> & PaletteHints;
  /** Convenience flags so call sites read well. */
  isRide: boolean;
  isShop: boolean;
  isScenery: boolean;
}

const DEFAULT_ACCENT = '#a855f7';

export function defineAttraction(a: AttractionInput): Attraction {
  if (!a.id || !/^[a-z][a-z0-9]*$/.test(a.id)) {
    throw new Error(`[content] bad id: ${JSON.stringify(a.id)} (lowercase alphanumeric)`);
  }
  if (a.category === 'shop' && !a.shop) {
    throw new Error(`[content] shop "${a.id}" must declare which need it satisfies`);
  }
  if (a.category === 'shop' && typeof a.price !== 'number') {
    throw new Error(`[content] shop "${a.id}" must declare a price`);
  }
  if (a.category === 'ride' && !a.capacity) {
    throw new Error(`[content] ride "${a.id}" must declare a capacity`);
  }

  const accent = a.accent ?? DEFAULT_ACCENT;
  return {
    id: a.id,
    label: a.label,
    category: a.category,
    cost: a.cost,
    rating: a.rating,
    size: a.size ?? 1,

    sceneryBonus: a.sceneryBonus ?? 0,
    nightBonus: a.nightBonus ?? 0,

    capacity: a.capacity ?? 0,
    cycleTime: a.cycleTime ?? 0,
    excitement: a.excitement ?? 0,

    shop: a.shop ?? null,
    price: a.price ?? 0,

    names: a.names ?? [],
    researchOrder: a.researchOrder ?? null,
    hotkey: a.hotkey ?? null,
    minimap: a.minimap ?? accent,
    accent,
    ui: a.ui,

    isRide: a.category === 'ride',
    isShop: a.category === 'shop',
    isScenery: a.category === 'scenery',
  };
}
