/**
 * Guest needs as data.
 *
 * The monolith hardcoded these in Guest.update() as a chain:
 *
 *   if (sd.shop === 'hunger'  && this.hunger  > 60) { this.hunger  = 10; ... }
 *   else if (sd.shop === 'thirst' && this.thirst > 60) { ... }
 *   else if (sd.shop === 'bladder' && ...
 *
 * so adding a shop that served a NEW need meant editing guest AI. Now a shop
 * declares `shop: 'hunger'` and the AI walks this table.
 */

import type { NeedId } from './define';

export interface Need {
  id: NeedId;
  /** Per-frame growth while wandering. */
  growth: number;
  /** Guests will buy once the need exceeds this. */
  buyAbove: number;
  /** Level the need drops to after a purchase. */
  resetTo: number;
  /** Above this, the need starts eroding happiness... */
  painAbove: number;
  /** ...at this much per frame. */
  painRate: number;
  /** Finishing the purchase drops litter. */
  litters: boolean;
  /** Shown in the guest inspector. */
  label: string;
}

export const NEEDS: Need[] = [
  { id: 'hunger',  growth: 0.015, buyAbove: 60, resetTo: 10, painAbove: 85, painRate: 0.020, litters: true,  label: 'Hunger' },
  { id: 'thirst',  growth: 0.020, buyAbove: 60, resetTo: 10, painAbove: 85, painRate: 0.025, litters: true,  label: 'Thirst' },
  { id: 'bladder', growth: 0.012, buyAbove: 60, resetTo: 5,  painAbove: 90, painRate: 0.030, litters: false, label: 'Need for restroom' },
];

export const NEED_BY_ID: Record<string, Need> = Object.fromEntries(
  NEEDS.map((n) => [n.id, n]),
);

/** 'balloon' is not a need on this table -- it is a want, handled separately:
 *  a guest buys one at random rather than because a meter filled up. */
export const BALLOON_BUY_CHANCE = 0.25;
export const BALLOON_HAPPINESS = 10;
