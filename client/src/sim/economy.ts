import type { GameState } from '../core/state';
import { emptyLedger } from '../core/state';
import { RESEARCH_ORDER, TYPE_LABEL, MARKETING_CAMPAIGNS, type MarketingCampaignId } from '../content';
import { parkRating } from './park';
import * as Fin from './finance';
import { isNightAt } from './time';
import { recomputeCleanliness } from './litter';
import { dailyWages } from './staff';
import { processRideQueues, type RideEvent } from './rides';

export type EconomyEvent = RideEvent;

/** Also read by main.ts for the Finance tab's interest-rate display. */
export const DAILY_INTEREST = 0.005;
const FIREWORK_SHOW_TICKS = 20; // ~30 seconds of fireworks (20 × 1.5s economy ticks)
/** Hours advanced per economy tick (1.5s). Also read by main.ts's day/night
 *  alpha and the fixed-timestep loop's economy accumulator. */
export const TIME_SPEED = 0.15;
const ENTRANCE_TILES: [number, number][] = [
  [0, 6],
  [0, 7],
  [0, 8],
];
const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export function perceivedValue(state: GameState): number {
  return Math.max(2, Math.round(parkRating(state) / 22 + state.parkHappiness / 12 + Object.keys(state.rideQueues).length * 0.8));
}

export interface DailyBooksResult {
  events: EconomyEvent[];
  researchUnlocked: string | null;
  checkAwards: boolean;
}

/** Wages, loan interest, research spend, marketing countdown, the every-3-day
 *  awards check, and the bankruptcy warning. Runs once per in-game day. */
export function runDailyBooks(state: GameState): DailyBooksResult {
  const events: EconomyEvent[] = [];
  let researchUnlocked: string | null = null;

  state.dayLedger = emptyLedger();

  const wages = dailyWages(state);
  if (wages > 0) {
    Fin.spend(state, wages, 'wages');
    if (state.funds < 0) events.push({ msg: `Payroll of $${wages.toLocaleString()} put you in the red!`, type: 'bad' });
  }

  if (state.loanBalance > 0) {
    const interest = Math.ceil(state.loanBalance * DAILY_INTEREST);
    Fin.spend(state, interest, 'interest');
    events.push({ msg: `Loan interest charged: $${interest.toLocaleString()}.`, type: 'info' });
  }

  const nextTool = RESEARCH_ORDER.find((t) => !state.research.unlocked.includes(t));
  if (nextTool && state.research.budget > 0 && state.funds >= state.research.budget) {
    Fin.spend(state, state.research.budget, 'research');
    state.research.progress += state.research.budget / 6;
    if (state.research.progress >= 100) {
      state.research.progress = 0;
      state.research.unlocked.push(nextTool);
      researchUnlocked = nextTool;
      events.push({ msg: `🔬 R&D breakthrough: ${TYPE_LABEL[nextTool]} is now available to build!`, type: 'good' });
    }
  }

  if (state.marketing.key) {
    state.marketing.daysLeft--;
    if (state.marketing.daysLeft <= 0) {
      events.push({ msg: `${MARKETING_CAMPAIGNS[state.marketing.key as MarketingCampaignId].label} has ended.`, type: 'info' });
      state.marketing = { key: null, daysLeft: 0 };
    }
  }

  let checkAwards = false;
  if (state.dayCount - state.lastAwardDay >= 3) {
    state.lastAwardDay = state.dayCount;
    checkAwards = true;
  }

  if (state.funds < -2000) events.push({ msg: 'You are deep in debt. Consider a loan or raising prices.', type: 'bad' });

  return { events, researchUnlocked, checkAwards };
}

export interface EconomyTickResult {
  events: EconomyEvent[];
  /** Caller should `new Guest(ENTRANCE_X, ENTRANCE_Y)` this many times and
   *  push them onto state.visualGuests -- sim can't construct the display-
   *  owning Guest class (see sim/guests.ts). */
  guestsToSpawn: number;
  /** The one guest removed because attendance target dropped below current
   *  guests, already popped from state.visualGuests. The caller checks this
   *  against its own "currently inspected guest" UI state (not part of
   *  GameState) to close that panel -- matching the original, this is NOT
   *  populated for the bulk removals below when the park closes; that path
   *  never checked the inspected guest either. */
  singleLeaver: unknown | null;
  dayRolled: boolean;
  researchUnlocked: string | null;
  checkAwards: boolean;
  /** fireworksActive/fireworksTimer are transient FX state, deliberately not
   *  part of GameState (see core/state.ts's own note on this). The caller
   *  owns the variables; this function just threads them through so the
   *  midnight-fireworks logic below can read and update them. */
  fireworksActive: boolean;
  fireworksTimer: number;
}

/** One 1.5s economy tick: time/day advance, weather, park open/closed,
 *  attendance targeting and guest arrival/departure, ride queues, and the
 *  midnight fireworks show. Driven by the fixed-timestep loop, not its own
 *  setInterval -- see core/loop timing in main.ts. */
export function economyTick(state: GameState, fx: { fireworksActive: boolean; fireworksTimer: number }): EconomyTickResult {
  const events: EconomyEvent[] = [];
  let dayRolled = false;
  let researchUnlocked: string | null = null;
  let checkAwards = false;
  let guestsToSpawn = 0;
  let singleLeaver: unknown | null = null;
  let { fireworksActive, fireworksTimer } = fx;

  // Advance time
  state.gameTime = (state.gameTime + TIME_SPEED) % 24;
  if (state.gameTime < TIME_SPEED) {
    state.dayCount++;
    events.push({ msg: `— Day ${state.dayCount} begins —`, type: 'info' });
    dayRolled = true;
    const daily = runDailyBooks(state);
    events.push(...daily.events);
    researchUnlocked = daily.researchUnlocked;
    checkAwards = daily.checkAwards;
  }

  // Weather roll
  state.weatherTicks--;
  if (state.weatherTicks <= 0) {
    state.weatherTicks = 25 + Math.floor(Math.random() * 30);
    const prev = state.weather;
    const r = Math.random();
    state.weather = r < 0.55 ? 'clear' : r < 0.8 ? 'cloudy' : 'rain';
    if (state.weather !== prev) {
      if (state.weather === 'rain') events.push({ msg: 'Rain moves in — attendance will dip.', type: 'bad' });
      else if (prev === 'rain') events.push({ msg: 'The rain clears. Guests are coming back!', type: 'good' });
      else if (state.weather === 'cloudy') events.push({ msg: 'Clouds drift over the park.', type: 'info' });
    }
  }

  // Check park open/closed. The gate is 3 tiles wide — a path touching any of
  // them opens the park.
  let connected = false;
  for (const [ex, ey] of ENTRANCE_TILES) {
    for (const [dx, dy] of DIRS) {
      const nx = ex + dx,
        ny = ey + dy;
      if (nx >= 0 && nx < state.gridSize && ny >= 0 && ny < state.gridSize && state.map[nx][ny] === 'path') {
        connected = true;
        break;
      }
    }
    if (connected) break;
  }
  if (connected && !state.isParkOpen) {
    state.isParkOpen = true;
    events.push({ msg: 'Path connected to Entrance! The park is now OPEN.', type: 'good' });
  } else if (!connected && state.isParkOpen) {
    state.isParkOpen = false;
    events.push({ msg: 'Path to Entrance severed. The park is CLOSED.', type: 'bad' });
  }

  const night = isNightAt(state.gameTime);
  const nightMultiplier = night ? 0.4 : 1.0;
  const weatherMultiplier = state.weather === 'rain' ? 0.45 : state.weather === 'cloudy' ? 0.85 : 1.0;

  if (state.isParkOpen) {
    // Attendance = rating × happiness × night × weather × price appeal × marketing
    const happinessMultiplier = 0.5 + (state.parkHappiness / 100) * 1.0;
    const pv = perceivedValue(state);
    // Cheap tickets draw crowds; overpricing empties the park.
    const priceMultiplier =
      state.admissionPrice <= pv
        ? 1 + (pv - state.admissionPrice) * 0.05
        : Math.max(0.08, 1 - (state.admissionPrice - pv) * 0.14);
    const campaignMultiplier = state.marketing.key ? 1 + MARKETING_CAMPAIGNS[state.marketing.key as MarketingCampaignId].boost : 1;
    const cleanMultiplier = 0.7 + (state.cleanliness / 100) * 0.3;
    const targetGuests = Math.floor(
      (parkRating(state) / 3) * happinessMultiplier * nightMultiplier * weatherMultiplier * priceMultiplier * campaignMultiplier * cleanMultiplier,
    );

    if (state.guests < targetGuests) {
      const newGuests = Math.floor(Math.random() * 3) + 1;
      state.guests += newGuests;
      guestsToSpawn = newGuests;
      for (let i = 0; i < newGuests; i++) {
        // Each arrival pays admission at the gate.
        if (state.admissionPrice > 0) Fin.earn(state, state.admissionPrice, 'admission');
      }
    }
    if (state.guests > targetGuests && state.guests > 0) {
      state.guests -= 1;
      singleLeaver = state.visualGuests.pop() ?? null;
    }

    events.push(...processRideQueues(state));

    // Calculate park happiness average
    if (state.visualGuests.length > 0) {
      let totalHappy = 0;
      for (const g of state.visualGuests as { happiness: number }[]) totalHappy += g.happiness;
      state.parkHappiness = totalHappy / state.visualGuests.length;
    }

    // Day/night flavor events
    if (night && Math.random() > 0.95) events.push({ msg: 'The park glows under the night sky...', type: 'info' });
    const hour = Math.floor(state.gameTime);
    if (hour === 6 && state.gameTime - hour < TIME_SPEED) events.push({ msg: 'Dawn breaks — guests are arriving!', type: 'good' });
    if (hour === 19 && state.gameTime - hour < TIME_SPEED) events.push({ msg: 'Night falls over the park...', type: 'info' });

    // Midnight fireworks show!
    if (hour === 0 && state.gameTime - hour < TIME_SPEED && !fireworksActive) {
      fireworksActive = true;
      fireworksTimer = FIREWORK_SHOW_TICKS;
      events.push({ msg: '✦ MIDNIGHT FIREWORKS! The sky lights up! ✦', type: 'good' });
      // Big happiness boost for everyone watching.
      for (const g of state.visualGuests as { happiness: number }[]) g.happiness = Math.min(100, g.happiness + 25);
    }

    // Count down fireworks show
    if (fireworksActive) {
      fireworksTimer--;
      if (fireworksTimer <= 0) {
        fireworksActive = false;
        events.push({ msg: 'The fireworks finale dazzles the crowd!', type: 'good' });
        // Final happiness bump.
        for (const g of state.visualGuests as { happiness: number }[]) g.happiness = Math.min(100, g.happiness + 10);
      }
    }
  } else if (state.guests > 0) {
    state.guests = Math.max(0, state.guests - 5);
    while (state.visualGuests.length > state.guests) state.visualGuests.pop();
  }

  // Guests, staff and FX advance in simTick(); this is the slow tick.
  recomputeCleanliness(state);

  return { events, guestsToSpawn, singleLeaver, dayRolled, researchUnlocked, checkAwards, fireworksActive, fireworksTimer };
}
