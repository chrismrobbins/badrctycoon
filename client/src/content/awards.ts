/**
 * Award metadata, split out from the predicates.
 *
 * The rating each award is worth has to be data rather than a closure, because
 * `rating` is now derived — `parkRating()` recomputes it as
 * `Σ(ratings from the map) + Σ(ratings of awards won)`, and the server does the
 * same to validate it (API-CONTRACT.md check 10).
 *
 * The `test` predicates stay in main.ts for now: they read live game state and
 * belong with the simulation, which is still un-extracted (ARCHITECTURE §8).
 * They are keyed by the ids below, and awards.spec.ts asserts the two sets match.
 */

export interface AwardDef {
  id: string;
  label: string;
  /** Font Awesome class. */
  icon: string;
  /** Permanent park-rating bonus for winning it. */
  rating: number;
}

export const AWARDS: AwardDef[] = [
  { id: 'clean',   label: 'Cleanest Park in the Region', icon: 'fa-broom',         rating: 40 },
  { id: 'value',   label: 'Best Value Park',             icon: 'fa-tags',          rating: 45 },
  { id: 'thrill',  label: 'Most Thrilling Park',         icon: 'fa-bolt',          rating: 60 },
  { id: 'safe',    label: 'Safest Park',                 icon: 'fa-shield-halved', rating: 55 },
  { id: 'staffed', label: 'Best Staffed Park',           icon: 'fa-user-group',    rating: 40 },
  { id: 'beauty',  label: 'Most Beautiful Park',         icon: 'fa-seedling',      rating: 50 },
  { id: 'tycoon',  label: 'Tycoon of the Year',          icon: 'fa-crown',         rating: 80 },
];

export const AWARD_BY_ID: Record<string, AwardDef> = Object.fromEntries(
  AWARDS.map((a) => [a.id, a]),
);
