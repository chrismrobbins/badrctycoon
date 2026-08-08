import type { GameState } from '../core/state';
import { PALETTE_GROUPS } from '../content';

/** Generated from the content registry rather than hand-written in
 *  index.html, so a new attraction needs no markup change. Non-attraction
 *  tools (Buy Land, Bulldozer) stay in the HTML and are left in place. */
function money0(n: number): string {
  return '$' + n.toLocaleString();
}

export function isUnlocked(state: GameState, tool: string): boolean {
  return tool === 'bulldozer' || state.research.unlocked.includes(tool);
}

function paletteButton(a: (typeof PALETTE_GROUPS)[number]['items'][number]): string {
  const size = a.size > 1 ? ` <span class="text-[9px] text-blue-400">(${a.size}×${a.size})</span>` : '';
  const note = a.ui.note ? `<div class="text-[9px] text-slate-400 dark:text-gray-500">${a.ui.note}</div>` : '';
  return `
        <button class="build-btn glass rounded-xl p-3 flex flex-col items-center gap-2 hover:bg-white/50 dark:hover:bg-white/5${a.ui.span ? ' col-span-2' : ''}"
                data-act="setTool" data-arg="${a.id}">
            <div class="w-10 h-10 rounded-full ${a.ui.iconBg} flex items-center justify-center ${a.ui.iconFg}"><i class="fas ${a.ui.icon}"></i></div>
            <div class="text-center">
                <div class="text-xs font-bold">${a.ui.short ?? a.label}${size}</div>
                <div class="text-[10px] text-green-600 dark:text-green-400">${money0(a.cost)}</div>
                ${note}
            </div>
        </button>`;
}

export function renderPalette(): void {
  const host = document.getElementById('build-palette');
  if (!host) return;
  const html = PALETTE_GROUPS.map((g) => {
    const heading = g.heading
      ? `<div class="col-span-2 mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-600 px-1">${g.heading}</div>`
      : '';
    return heading + g.items.map(paletteButton).join('');
  }).join('');
  host.insertAdjacentHTML('afterbegin', html);
}

/** Greys out and disables build buttons for tools not yet researched. */
export function refreshPalette(state: GameState): void {
  // The tool id is data-arg now. This used to parse it back out of the
  // onclick="setTool('x')" attribute, which phase 1 removed -- so locking
  // silently stopped working until this was fixed.
  document.querySelectorAll<HTMLElement>('.build-btn').forEach((btn) => {
    const t = btn.dataset.act === 'setTool' ? btn.dataset.arg : undefined;
    if (!t) return;
    const locked = !isUnlocked(state, t);
    btn.classList.toggle('locked', locked);
    btn.title = locked ? 'Not researched yet — fund R&D in Manage → Research' : '';
  });
}
