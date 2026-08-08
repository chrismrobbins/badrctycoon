import type { GameState } from '../core/state';
import { OBJECTIVES } from '../sim/objectives';

/** Redraws the objectives checklist panel from state.objectiveIndex. */
export function renderObjectives(state: GameState): void {
  const list = document.getElementById('objective-list');
  if (!list) return;
  list.innerHTML = '';
  OBJECTIVES.forEach((o, i) => {
    const row = document.createElement('div');
    const done = i < state.objectiveIndex;
    const current = i === state.objectiveIndex;
    row.className =
      'flex items-start gap-2 text-[11px] ' +
      (done ? 'text-green-500' : current ? 'text-slate-800 dark:text-white font-bold' : 'text-slate-400 dark:text-gray-600');
    row.innerHTML = `<i class="fas ${done ? 'fa-check-circle' : current ? 'fa-bullseye' : 'fa-lock'} mt-0.5 text-[10px]"></i><span>${o.text} <span class="text-green-600 dark:text-green-400 font-normal">+$${o.reward.toLocaleString()}</span></span>`;
    list.appendChild(row);
  });
}
