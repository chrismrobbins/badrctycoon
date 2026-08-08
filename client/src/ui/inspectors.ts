import type { GameState, RideQueue } from '../core/state';
import { BUILD_DATA, RIDE_TYPES, SHOP_TYPES, TYPE_LABEL, NAME_POOL } from '../content';
import { getSceneryBonusAt } from '../sim/scenery';
import { isNightAt } from '../sim/time';
import { litterAt } from '../sim/litter';
import { logEvent } from './eventlog';
import { money } from './management';

// ── Naming ──
// Every ride gets a name on construction; the player can rename it.

export function nextName(type: string, state: GameState): string {
  const pool = NAME_POOL[type] || [TYPE_LABEL[type] || type];
  const used = new Set(Object.values(state.rideNames));
  for (const n of pool) if (!used.has(n)) return n;
  // Pool exhausted — number them.
  let i = 2;
  while (used.has(`${pool[0]} ${i}`)) i++;
  return `${pool[0]} ${i}`;
}

export function randomName(type: string): string {
  const pool = NAME_POOL[type] || [TYPE_LABEL[type] || type];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Accepts either a Tailwind-ish name (legacy callers) or a raw CSS color, and
// always emits an inline color so nothing depends on uncompiled utilities.
export const CLS2HEX: Record<string, string> = {
  'text-green-500': '#16a34a',
  'text-red-500': '#ef4444',
  'text-blue-500': '#2563eb',
  'text-purple-500': '#a855f7',
  'text-orange-500': '#ea580c',
  'text-yellow-500': '#ca8a04',
  'text-indigo-400': '#818cf8',
  'text-slate-400': '#94a3b8',
};

export function statRow(label: string | number, value: string | number, color?: string | null): string {
  const hex = (color && CLS2HEX[color]) || (color && color.charAt(0) === '#' ? color : null);
  return `<div class="m-row"><span class="l">${label}</span><span class="r"${hex ? ` style="color:${hex}"` : ''}>${value}</span></div>`;
}

// ── Ride/shop inspector panel ──
export let inspectedKey: string | null = null;

export function anchorKeyAt(state: GameState, x: number, y: number): string {
  const a = state.anchorOf[`${x},${y}`];
  return a ? `${a.ax},${a.ay}` : `${x},${y}`;
}

export function openRidePanel(state: GameState, key: string): void {
  const [ax, ay] = key.split(',').map(Number);
  const type = state.map[ax]?.[ay];
  if (!type || (!RIDE_TYPES.has(type) && !SHOP_TYPES.has(type))) return;
  inspectedKey = key;
  if (!state.rideNames[key]) state.rideNames[key] = nextName(type, state);
  document.getElementById('ride-panel').classList.remove('hidden');
  const nameEl = document.getElementById('ride-name') as HTMLInputElement;
  nameEl.value = state.rideNames[key];
  document.getElementById('ride-type').textContent = TYPE_LABEL[type] || type;
  renderRideStats(state);
}

export function closeRidePanel(): void {
  inspectedKey = null;
  document.getElementById('ride-panel').classList.add('hidden');
}

export function renderRideStats(state: GameState): void {
  if (!inspectedKey) return;
  const [ax, ay] = inspectedKey.split(',').map(Number);
  const type = state.map[ax]?.[ay];
  if (!type) {
    closeRidePanel();
    return;
  }
  const d = BUILD_DATA[type];
  const el = document.getElementById('ride-stats');
  let html = '';
  if (RIDE_TYPES.has(type)) {
    const q: Partial<RideQueue> = state.rideQueues[inspectedKey] || {};
    const scenery = getSceneryBonusAt(state, ax, ay);
    const nightB = isNightAt(state.gameTime) ? d.nightBonus : 0;
    const total = d.excitement + scenery + nightB;
    html += statRow('Status', q.broken ? 'BROKEN DOWN' : 'Operating', q.broken ? 'text-red-500' : 'text-green-500');
    html += statRow('Queue', `${q.queue || 0} waiting`, 'text-purple-500');
    html += statRow('On board', `${q.ridersOnBoard || 0} / ${d.capacity}`, 'text-blue-500');
    html += statRow('Excitement', total, 'text-orange-500');
    html += statRow('· base', d.excitement);
    html += statRow('· scenery', `+${scenery}`, 'text-green-500');
    if (nightB) html += statRow('· night bonus', `+${nightB}`, 'text-indigo-400');
    html += statRow('Cycle time', `${d.cycleTime}s`);
    html += statRow('Total riders', (q.riders || 0).toLocaleString(), 'text-blue-500');
    html += statRow('Revenue', `$${(q.earned || 0).toLocaleString()}`, 'text-green-500');
    html += statRow('Breakdowns', q.breakdowns || 0, q.breakdowns ? 'text-red-500' : null);
    html += statRow('Built for', `$${d.cost.toLocaleString()}`);
  } else {
    const s = state.shopStats[inspectedKey] || { sales: 0, earned: 0 };
    html += statRow('Status', 'Open', 'text-green-500');
    html += statRow('Price per sale', `$${d.price}`, 'text-green-500');
    html += statRow('Total sales', s.sales.toLocaleString(), 'text-blue-500');
    html += statRow('Revenue', `$${s.earned.toLocaleString()}`, 'text-green-500');
    html += statRow('Built for', `$${d.cost.toLocaleString()}`);
    const paid = s.earned >= d.cost;
    html += `<div style="margin-top:0.375rem;font-size:10px;font-weight:700;color:${paid ? '#16a34a' : '#94a3b8'}">${paid ? '✓ Has paid for itself' : `$${(d.cost - s.earned).toLocaleString()} to break even`}</div>`;
  }
  el.innerHTML = html;
}

// ── Guest inspector panel ──
interface GuestLike {
  name: string;
  color: string;
  happiness: number;
  hunger: number;
  thirst: number;
  bladder: number;
  hasBalloon: boolean;
  money: number;
  ridesRidden: number;
  x: number;
  y: number;
  queuedAt: string | null;
}

export let inspectedGuest: GuestLike | null = null;

export function openGuestPanel(state: GameState, g: GuestLike): void {
  inspectedGuest = g;
  closeRidePanel();
  document.getElementById('guest-panel').classList.remove('hidden');
  document.getElementById('guest-name').textContent = g.name;
  renderGuestStats(state);
}

export function closeGuestPanel(): void {
  inspectedGuest = null;
  document.getElementById('guest-panel').classList.add('hidden');
}

export function bar(label: string, pct: number, color?: string | null, invert?: boolean): string {
  const v = Math.max(0, Math.min(100, pct));
  const c = invert ? (v > 80 ? '#ef4444' : v > 55 ? '#f59e0b' : '#22c55e') : v > 70 ? '#22c55e' : v > 40 ? '#f59e0b' : '#ef4444';
  return `<div><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;"><span style="color:#94a3b8">${label}</span><span style="font-weight:700">${Math.round(v)}%</span></div>
        <div class="meter"><span style="width:${v}%;background:${color || c}"></span></div></div>`;
}

export function renderGuestStats(state: GameState): void {
  if (!inspectedGuest) return;
  const g = inspectedGuest;
  if (!state.visualGuests.includes(g)) {
    closeGuestPanel();
    logEvent('That guest has left the park.', 'info');
    return;
  }
  const mood =
    g.happiness >= 80
      ? ['Delighted', 'text-green-500']
      : g.happiness >= 60
        ? ['Happy', 'text-green-500']
        : g.happiness >= 40
          ? ['Okay', 'text-yellow-500']
          : g.happiness >= 20
            ? ['Unhappy', 'text-orange-500']
            : ['Furious', 'text-red-500'];
  document.getElementById('guest-name').textContent = g.name;
  document.getElementById('guest-stats').innerHTML =
    `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span style="width:0.75rem;height:0.75rem;border-radius:999px;background:${g.color}"></span>
            <span style="font-weight:700;color:${CLS2HEX[mood[1]] || '#94a3b8'}">${mood[0]}</span>
            ${g.hasBalloon ? '<i class="fas fa-circle" style="color:#f472b6;font-size:8px;margin-left:auto;" title="Has a balloon"></i>' : ''}</div>` +
    bar('Happiness', g.happiness) +
    bar('Hunger', g.hunger, null, true) +
    bar('Thirst', g.thirst, null, true) +
    bar('Need for restroom', g.bladder, null, true) +
    `<div style="margin-top:0.5rem;">
            ${statRow('Wallet', money(g.money), 'text-green-500')}
            ${statRow('Rides ridden', g.ridesRidden)}
            ${statRow('Location', `(${g.x}, ${g.y})`)}
           </div>
           <div style="margin-top:0.5rem;font-size:11px;font-style:italic;color:#94a3b8;">"${guestThought(state, g)}"</div>`;
}

export function guestThought(state: GameState, g: GuestLike): string {
  if (g.queuedAt) return `I hope ${state.rideNames[g.queuedAt] || 'this ride'} is worth the wait...`;
  if (g.bladder > 88) return 'I really need to find a restroom.';
  if (g.thirst > 85) return 'I am so thirsty. Where are the drinks?';
  if (g.hunger > 85) return 'I could eat an entire funnel cake right now.';
  if (litterAt(state, g.x, g.y) > 1) return 'This place is filthy. Does anyone clean up?';
  if (g.happiness < 25) return 'I want to go home.';
  if (g.happiness > 85) return 'This is the best park I have ever been to!';
  if (isNightAt(state.gameTime)) return 'The lights look lovely at night.';
  if (g.ridesRidden === 0) return 'Now what should I ride first?';
  return 'What a nice day out.';
}
