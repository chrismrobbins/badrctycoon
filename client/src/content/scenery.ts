import { defineAttraction } from './define';

/** Paths and decoration. Scenery within 3 tiles raises a ride's excitement. */
export const SCENERY = [
  defineAttraction({
    id: 'path', label: 'Path', category: 'path',
    cost: 10, rating: 1, hotkey: 1, minimap: '#94a3b8',
    ui: { icon: 'fa-road', iconBg: 'bg-slate-200 dark:bg-gray-800', iconFg: 'text-slate-600 dark:text-gray-300' },
  }),

  defineAttraction({
    id: 'flowerbed', label: 'Flower Bed', category: 'scenery',
    cost: 25, rating: 2, sceneryBonus: 3, minimap: '#ec4899',
    ui: { icon: 'fa-leaf', short: 'Flowers', iconBg: 'bg-pink-50 dark:bg-pink-900/30', iconFg: 'text-pink-500' },
  }),

  defineAttraction({
    id: 'trashcan', label: 'Trash Can', category: 'scenery',
    cost: 30, rating: 1, sceneryBonus: 1, hotkey: 2, minimap: '#64748b',
    ui: { icon: 'fa-trash', iconBg: 'bg-slate-200 dark:bg-gray-800', iconFg: 'text-slate-600 dark:text-gray-300' },
  }),

  defineAttraction({
    id: 'bench', label: 'Bench', category: 'scenery',
    cost: 45, rating: 3, sceneryBonus: 2, hotkey: 3, minimap: '#b45309',
    ui: { icon: 'fa-chair', iconBg: 'bg-amber-100 dark:bg-amber-900/30', iconFg: 'text-amber-700 dark:text-amber-400' },
  }),

  defineAttraction({
    id: 'lamp', label: 'Park Lamp', category: 'scenery',
    cost: 40, rating: 3, sceneryBonus: 2, nightBonus: 8, hotkey: 4, minimap: '#fde047',
    ui: { icon: 'fa-lightbulb', iconBg: 'bg-yellow-50 dark:bg-yellow-900/30', iconFg: 'text-yellow-500' },
  }),

  defineAttraction({
    id: 'tree', label: 'Tree Grove', category: 'scenery',
    cost: 50, rating: 5, sceneryBonus: 4, hotkey: 5, minimap: '#15803d',
    ui: { icon: 'fa-tree', iconBg: 'bg-green-100 dark:bg-green-900/30', iconFg: 'text-green-600 dark:text-green-400' },
  }),

  defineAttraction({
    id: 'fountain', label: 'Fountain', category: 'scenery',
    cost: 150, rating: 15, sceneryBonus: 10, hotkey: 6, minimap: '#3b82f6',
    ui: { icon: 'fa-water', iconBg: 'bg-blue-100 dark:bg-blue-900/30', iconFg: 'text-blue-600 dark:text-blue-400' },
  }),
];
