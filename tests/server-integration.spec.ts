import { test, expect } from '@playwright/test';

import { createGameState, type GameState } from '../client/src/core/state';
import { earn } from '../client/src/sim/finance';
import { createApi } from '../client/src/net/client';
import { createSyncEngine } from '../client/src/save/sync';

/**
 * Step 6 of docs/BACKEND-HANDOFF.md's build order: point the already-written
 * client (net/client.ts, save/sync.ts) at a real server instead of the fake
 * one in tests/sync.spec.ts. This is "where you find out what the contract
 * got wrong" (handoff §5 step 6) -- these tests exercise the real HTTP
 * round-trip, cookie-based sessions, and the 409 conflict path against
 * Postgres, not an in-memory stand-in.
 *
 * Skips cleanly (not a failure) when no server is reachable, so `npm test`
 * on a fresh clone stays exactly as green as docs/BACKEND-HANDOFF.md
 * promises -- these tests are additive, not a new baseline requirement.
 * Run a server first (see the handoff) and set SERVER_URL if it's not on
 * the default port.
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8787';
const PASSWORD = 'integration-test-password';

let serverAvailable = false;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
});

/**
 * createApi()'s fetchImpl is a plain `fetch` by default, and Node's fetch --
 * unlike a browser tab -- does not remember Set-Cookie between calls. This
 * wrapper is the minimum needed to make one createApi() instance behave like
 * one signed-in browser tab; a second instance with its own jar is a second,
 * independent device on the same account.
 */
function sessionFetch(): typeof fetch {
  let cookie: string | undefined;
  return (async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(input, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return res;
  }) as typeof fetch;
}

function newDevice() {
  return createApi({ baseUrl: SERVER_URL, fetchImpl: sessionFetch() });
}

function uniqueUsername(): string {
  // Real usernames, not deletable by this suite -- unique per run so repeat
  // runs against a persistent dev database never collide with each other.
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * createGameState() alone is not what a real client ever saves: the map
 * starts as `[]`, and it's client/src/main.ts's newGame() -- UI-layer code,
 * not one of the pure modules -- that sizes it to gridSize x gridSize before
 * the park is playable. Validation check 4 (API-CONTRACT.md §6) correctly
 * rejects the bare createGameState() shape; this stands in for newGame()'s
 * part of the job so these tests send what a real client actually would.
 */
function freshParkState(): GameState {
  const state = createGameState();
  state.map = Array.from({ length: state.gridSize }, () => Array(state.gridSize).fill(null));
  return state;
}

test.describe('real client against a real server', () => {
  test('register, login, and /me round-trip', async () => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);

    const api = newDevice();
    const username = uniqueUsername();
    const registered = await api.register({ username, password: PASSWORD });
    expect(registered.username).toBe(username);

    const me = await api.me();
    expect(me?.id).toBe(registered.id);

    await api.logout();
    expect(await api.me()).toBeNull();
  });

  test('a park saved from one session loads in a second, independent one', async () => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);

    const username = uniqueUsername();
    const deviceA = newDevice();
    await deviceA.register({ username, password: PASSWORD });

    let stateA = freshParkState();
    earn(stateA, 2345, 'admission'); // funds 10000 -> 12345, ledger stays honest
    const engineA = createSyncEngine({
      api: deviceA,
      getState: () => stateA,
      applyState: (s) => { stateA = s; },
      getPlaytimeMs: () => 60_000,
    });
    engineA.attach(1, 'Integration Park', 0);
    engineA.markDirty();
    await engineA.pushNow();
    expect(engineA.status).toBe('synced');

    // A second, independent session: a fresh cookie jar, same account.
    const deviceB = newDevice();
    await deviceB.login({ username, password: PASSWORD });
    const loaded = await deviceB.loadSlot(1);
    expect(loaded.state.funds).toBe(12345);
    expect(loaded.meta.parkName).toBe('Integration Park');
    expect(loaded.meta.revision).toBe(1);
  });

  test('two devices racing the same slot: the loser gets a 409, and takeRemote catches it up', async () => {
    test.skip(!serverAvailable, `No server at ${SERVER_URL} -- see docs/BACKEND-HANDOFF.md to run one.`);

    const username = uniqueUsername();
    const deviceA = newDevice();
    await deviceA.register({ username, password: PASSWORD });

    let stateA = freshParkState();
    const engineA = createSyncEngine({
      api: deviceA,
      getState: () => stateA,
      applyState: (s) => { stateA = s; },
      getPlaytimeMs: () => 0,
    });
    engineA.attach(2, 'Race Park', 0);
    engineA.markDirty();
    await engineA.pushNow(); // slot now at revision 1

    const deviceB = newDevice();
    await deviceB.login({ username, password: PASSWORD });
    let stateB = freshParkState();
    const conflicts: unknown[] = [];
    const engineB = createSyncEngine({
      api: deviceB,
      getState: () => stateB,
      applyState: (s) => { stateB = s; },
      getPlaytimeMs: () => 0,
      events: { onConflict: (c) => conflicts.push(c) },
    });
    engineB.attach(2, 'Race Park', 1); // B agrees revision 1 is current -- for now

    // A moves the slot to revision 2 without B knowing.
    earn(stateA, 45_555, 'admission'); // funds -> 55555
    engineA.markDirty();
    await engineA.pushNow();
    expect(engineA.status).toBe('synced');

    // B pushes against its now-stale baseRevision (1) -- 409, never clobbers A.
    earn(stateB, 89_999, 'admission'); // funds -> 99999, ledger still honest
    engineB.markDirty();
    await engineB.pushNow();
    expect(engineB.status).toBe('conflict');
    expect(conflicts).toHaveLength(1);

    // B chooses the server's copy rather than clobbering it.
    await engineB.takeRemote();
    expect(engineB.status).toBe('synced');
    expect(stateB.funds).toBe(55_555);
  });
});
