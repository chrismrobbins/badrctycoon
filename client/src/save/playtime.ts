/**
 * Cumulative playtime for THIS device, independent of any single save slot.
 *
 * save/sync.ts's SyncOptions requires `getPlaytimeMs(): number`, and the
 * server's monotonic check (API-CONTRACT.md §6 check 9) requires every PUT's
 * playtimeMs to be >= that slot's previously stored value. One ever-growing
 * counter, persisted across reloads, satisfies that for free *as long as the
 * same device keeps saving the same slot* -- any earlier save from this
 * device recorded a value from an earlier point on this same always-
 * increasing timeline.
 *
 * That assumption breaks the moment a second device saves the same slot: a
 * freshly-installed device's counter starts near zero, and would look like
 * time travel the instant it tried to save a slot another device had
 * already played for hours. ensureAtLeast() is the fix -- ui/auth.ts calls
 * it with the slot's SlotMeta.playtimeMs whenever attaching to an existing
 * slot, so this device's counter jumps forward to at least what the slot
 * already has before it ever reports a number for that slot. (Caught by
 * tests/ui-auth.spec.ts's two-device test, which is exactly the scenario a
 * single-device manual test can't exercise.)
 *
 * Counts wall-clock time the tab was open, not simulated game time -- a
 * paused park, or one sitting on the Finance tab, is still "playtime." That
 * also keeps this a safe *lower* bound for the day-plausibility half of
 * check 9 (server/src/validation.ts): idle time can only inflate the number
 * this reports, never make a real day arrive faster than the sim's own speed
 * cap allows.
 */

const STORAGE_KEY = 'c2c_playtime_v1';
const PERSIST_INTERVAL_MS = 5_000;

function readStoredMs(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0; // private mode
  }
}

function writeStoredMs(ms: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(ms)));
  } catch {
    // private mode or quota -- this session's playtime just won't survive a reload
  }
}

let baseMs = readStoredMs();
let sessionStartedAt = Date.now();

/** What sync.ts should send with the next save. */
export function getPlaytimeMs(): number {
  return baseMs + (Date.now() - sessionStartedAt);
}

/** Jump this device's counter forward to at least `ms` if it's currently
 *  behind. Never moves it backward -- this device's own accumulated time
 *  (e.g. from playing other slots) is never worth losing. */
export function ensureAtLeast(ms: number): void {
  if (ms > getPlaytimeMs()) {
    baseMs = ms;
    sessionStartedAt = Date.now();
  }
}

function persist(): void {
  const now = Date.now();
  baseMs += now - sessionStartedAt;
  sessionStartedAt = now;
  writeStoredMs(baseMs);
}

/** Call once at boot. Keeps the persisted total honest without writing to
 *  localStorage on every tick. */
export function startPlaytimeTracking(): void {
  setInterval(persist, PERSIST_INTERVAL_MS);
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
}
