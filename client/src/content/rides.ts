import { defineAttraction } from './define';

/**
 * Rides, cheapest first. `researchOrder` is the unlock queue -- carousel has none
 * because it is available from the start.
 *
 * Adding a ride is this file plus a sprite in render/sprites.ts. Everything else
 * -- the palette button, the minimap colour, the research list, the type label,
 * the name pool, the renderer's dispatch -- derives from here.
 */
export const RIDES = [
  defineAttraction({
    id: 'carousel', label: 'Carousel', category: 'ride',
    cost: 800, rating: 50, capacity: 6, cycleTime: 3, excitement: 20,
    names: ['Circular Reference', 'The Standup', 'Merry Migration', 'Recursion'],
    ui: { icon: 'fa-horse-head', iconBg: 'bg-pink-100 dark:bg-pink-900/30', iconFg: 'text-pink-600 dark:text-pink-400' },
  }),

  defineAttraction({
    id: 'teacups', label: 'Tea Cups', category: 'ride',
    cost: 900, rating: 60, capacity: 8, cycleTime: 2.5, excitement: 25,
    researchOrder: 1,
    names: ['Coffee Break', 'Spin Cycle', 'The Retro', 'Caf2Cups'],
    ui: { icon: 'fa-coffee', iconBg: 'bg-purple-100 dark:bg-purple-900/30', iconFg: 'text-purple-500' },
  }),

  defineAttraction({
    id: 'bumper', label: 'Bumper Cars', category: 'ride',
    cost: 1200, rating: 70, capacity: 10, cycleTime: 3, excitement: 35,
    researchOrder: 3,
    names: ['Merge Conflict', 'Collision Detection', 'The Integration', 'Bumper Sync'],
    ui: { icon: 'fa-car-crash', iconBg: 'bg-orange-100 dark:bg-orange-900/30', iconFg: 'text-orange-500' },
  }),

  defineAttraction({
    id: 'droptower', label: 'Drop Tower', category: 'ride',
    cost: 1500, rating: 100, capacity: 4, cycleTime: 4, excitement: 60,
    researchOrder: 4,
    names: ['Freefall Friday', 'The Outage', 'Prod Drop', 'Latency Spike'],
    ui: { icon: 'fa-sort-amount-down', iconBg: 'bg-yellow-100 dark:bg-yellow-900/30', iconFg: 'text-yellow-600 dark:text-yellow-400' },
  }),

  defineAttraction({
    id: 'ship', label: 'Swinging Ship', category: 'ride',
    cost: 1800, rating: 120, size: 2, capacity: 12, cycleTime: 3.5, excitement: 50,
    researchOrder: 5, accent: '#f59e0b',
    names: ['Scope Creep', 'The Pendulum', 'Change Order', 'Swing Estimate'],
    ui: { icon: 'fa-ship', short: 'Swing Ship', iconBg: 'bg-cyan-100 dark:bg-cyan-900/30', iconFg: 'text-cyan-600 dark:text-cyan-400' },
  }),

  defineAttraction({
    id: 'haunted', label: 'Haunted House', category: 'ride',
    cost: 2000, rating: 150, size: 2, capacity: 6, cycleTime: 5, excitement: 70,
    nightBonus: 30, researchOrder: 7, accent: '#8b5cf6',
    names: ['Legacy System', 'The Sandbox', 'Undocumented Feature', 'Tech Debt Manor'],
    ui: { icon: 'fa-ghost', iconBg: 'bg-slate-200 dark:bg-gray-800', iconFg: 'text-slate-700 dark:text-white' },
  }),

  defineAttraction({
    id: 'gokarts', label: 'Go-Karts', category: 'ride',
    cost: 2200, rating: 180, size: 2, capacity: 8, cycleTime: 4, excitement: 55,
    researchOrder: 8, accent: '#22c55e',
    names: ['Race Condition', 'Parallel Processing', 'The Fast Track', 'Concurrency'],
    ui: { icon: 'fa-flag-checkered', iconBg: 'bg-slate-200 dark:bg-gray-800', iconFg: 'text-slate-700 dark:text-gray-200' },
  }),

  defineAttraction({
    id: 'ferriswheel', label: 'Ferris Wheel', category: 'ride',
    cost: 2500, rating: 200, size: 2, capacity: 16, cycleTime: 4, excitement: 45,
    researchOrder: 6, accent: '#3b82f6',
    names: ['Slow Refresh', 'The Sprint Wheel', 'Roundtable', 'Data Cycle'],
    ui: { icon: 'fa-life-ring', iconBg: 'bg-purple-100 dark:bg-purple-900/30', iconFg: 'text-purple-600 dark:text-purple-400' },
  }),

  defineAttraction({
    id: 'coaster', label: 'Rollercoaster', category: 'ride',
    cost: 4000, rating: 300, size: 2, capacity: 8, cycleTime: 5, excitement: 90,
    researchOrder: 9, accent: '#ef4444',
    names: ['The Reconciliation', 'Batch Job', 'Ledger Launch', 'Fiscal Freefall', 'The Rollback'],
    ui: { icon: 'fa-roller-coaster', span: true, iconBg: 'bg-red-100 dark:bg-red-900/30', iconFg: 'text-red-600 dark:text-red-400' },
  }),

  defineAttraction({
    id: 'megacoaster', label: 'Mega Coaster', category: 'ride',
    cost: 12000, rating: 800, size: 4, capacity: 24, cycleTime: 6, excitement: 150,
    nightBonus: 20, researchOrder: 10, accent: '#f43f5e',
    names: ['The Go-Live', 'Production Deploy', 'Full Reindex', 'The Hypercare', 'Cutover'],
    ui: {
      icon: 'fa-roller-coaster', span: true, note: 'Vertical loop · 24 riders',
      iconBg: 'bg-gradient-to-br from-rose-500 to-red-600', iconFg: 'text-white',
    },
  }),
];
