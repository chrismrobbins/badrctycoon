import { defineAttraction } from './define';

/**
 * Shops. `shop` names the need served -- the guest AI reads that rather than
 * branching on a hardcoded list, so a shop for a new need needs no AI change.
 */
export const SHOPS = [
  defineAttraction({
    id: 'balloonstand', label: 'Balloon Stand', category: 'shop',
    cost: 150, rating: 15, shop: 'balloon', price: 4,
    researchOrder: 2, minimap: '#f43f5e',
    names: ['Inflation', 'Balloon Payload', 'Float Values'],
    ui: { icon: 'fa-certificate', short: 'Balloons', iconBg: 'bg-rose-100 dark:bg-rose-900/30', iconFg: 'text-rose-500' },
  }),

  defineAttraction({
    id: 'restroom', label: 'Restroom', category: 'shop',
    cost: 200, rating: 10, shop: 'bladder', price: 3,
    hotkey: 9, minimap: '#94a3b8',
    names: ['Flush Cache', 'The Necessary', 'Restroom'],
    ui: { icon: 'fa-restroom', iconBg: 'bg-blue-100 dark:bg-blue-900/30', iconFg: 'text-blue-500' },
  }),

  defineAttraction({
    id: 'drinkstall', label: 'Drink Stall', category: 'shop',
    cost: 250, rating: 20, shop: 'thirst', price: 5,
    hotkey: 8, minimap: '#0ea5e9',
    names: ['Hydration Layer', 'The Refill', 'Cold Cache'],
    ui: { icon: 'fa-glass-water', iconBg: 'bg-sky-100 dark:bg-sky-900/30', iconFg: 'text-sky-600 dark:text-sky-400' },
  }),

  defineAttraction({
    id: 'foodstall', label: 'Food Stall', category: 'shop',
    cost: 300, rating: 25, shop: 'hunger', price: 8,
    hotkey: 7, minimap: '#f59e0b',
    names: ['Snack Overflow', 'The Cafeteria', 'Byte Bites'],
    ui: { icon: 'fa-burger', iconBg: 'bg-amber-100 dark:bg-amber-900/30', iconFg: 'text-amber-600 dark:text-amber-400' },
  }),
];
