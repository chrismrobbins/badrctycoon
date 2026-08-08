import type { GameState } from '../core/state';
import { parkRating, parkValue } from '../sim/park';
import { isNightAt } from '../sim/time';

export function formatTime(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

/** Refreshes the top status bar and the day/night overlay alpha. Returns
 *  whether it's currently night, so the caller can keep its own `isNight`
 *  (read by the ~30 draw functions still in main.ts) in sync -- that
 *  variable moves into render/ once it splits out; for now this is the same
 *  fx-threading shape sim/economy.ts uses for fireworks. */
export function updateStatusBar(state: GameState): boolean {
  document.getElementById('stat-funds').innerText = `$${state.funds.toLocaleString()}`;
  document.getElementById('stat-guests').innerText = String(state.guests);
  document.getElementById('stat-rating').innerText = String(parkRating(state));
  document.getElementById('stat-happiness').innerText = `${Math.round(state.parkHappiness)}%`;
  document.getElementById('stat-time').innerText = formatTime(state.gameTime);
  const dayEl = document.getElementById('stat-day');
  if (dayEl) dayEl.innerText = `Day ${state.dayCount}`;
  const clnEl = document.getElementById('stat-clean');
  if (clnEl) {
    clnEl.innerText = `${Math.round(state.cleanliness)}%`;
    clnEl.style.color = state.cleanliness > 80 ? '#14b8a6' : state.cleanliness > 50 ? '#f59e0b' : '#ef4444';
  }
  const valEl = document.getElementById('stat-value');
  if (valEl) valEl.innerText = `$${parkValue(state).toLocaleString()}`;
  const wEl = document.getElementById('stat-weather');
  if (wEl) {
    wEl.innerHTML =
      state.weather === 'clear'
        ? '<i class="fas fa-sun text-yellow-500"></i>'
        : state.weather === 'cloudy'
          ? '<i class="fas fa-cloud text-gray-400"></i>'
          : '<i class="fas fa-cloud-rain text-blue-400"></i>';
  }

  const happEl = document.getElementById('stat-happiness');
  if (state.parkHappiness >= 75) {
    happEl.classList.add('happy-high');
  } else {
    happEl.classList.remove('happy-high');
  }

  const statusEl = document.getElementById('stat-status');
  if (state.isParkOpen) {
    statusEl.innerText = 'OPEN';
    statusEl.classList.replace('text-red-500', 'text-green-500');
  } else {
    statusEl.innerText = 'CLOSED';
    statusEl.classList.replace('text-green-500', 'text-red-500');
  }

  // Day/Night cycle — compute darkness level (used by canvas renderer).
  const hour = state.gameTime % 24;
  let nightAlpha = 0;
  if (hour >= 20 || hour < 5) {
    nightAlpha = 0.55;
  } else if (hour >= 18) {
    nightAlpha = ((hour - 18) / 2) * 0.55;
  } else if (hour < 7) {
    nightAlpha = ((7 - hour) / 2) * 0.55;
  }
  // Store for render loop.
  (window as unknown as { _nightAlpha?: number })._nightAlpha = nightAlpha;

  return isNightAt(state.gameTime);
}
