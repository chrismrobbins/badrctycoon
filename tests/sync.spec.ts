import { test, expect } from '@playwright/test';

import { createGameState, type GameState } from '../client/src/core/state';
import { createSyncEngine, type SyncStatus } from '../client/src/save/sync';
import { ApiError, type Api, type SlotMeta } from '../client/src/net/client';
import { summarize } from '../client/src/save/schema';

/**
 * Cloud-save sync, against a fake server.
 *
 * Runs in Node: the engine only touches `document` and `navigator` inside
 * start(), which these tests never call. Everything else -- dirty tracking,
 * revision handling, conflict resolution -- is pure and testable here, which is
 * the point of keeping it out of the UI.
 *
 * The behaviour that matters most is the 409 path. Last-write-wins loses parks,
 * and two browser tabs are enough to trigger it.
 */

/** Minimal in-memory stand-in for the API, with real revision semantics. */
function fakeServer() {
  const slots = new Map<number, { meta: SlotMeta; state: GameState }>();
  let offline = false;
  let putCount = 0;

  const metaFor = (slot: number, parkName: string, revision: number, state: GameState): SlotMeta => ({
    slot, parkName, revision, updatedAt: '2026-01-01T00:00:00.000Z', playtimeMs: 0,
    ...summarize(state),
  });

  const api = {
    async saveSlot(slot, payload) {
      putCount++;
      if (offline) throw new ApiError(0, 'network_unreachable', 'offline');
      const existing = slots.get(slot);
      const current = existing?.meta.revision ?? 0;
      if (payload.baseRevision !== current) {
        throw new ApiError(409, 'revision_conflict', 'stale', existing!.meta);
      }
      const meta = metaFor(slot, payload.parkName, current + 1, payload.state);
      slots.set(slot, { meta, state: JSON.parse(JSON.stringify(payload.state)) });
      return meta;
    },
    async loadSlot(slot) {
      const row = slots.get(slot);
      if (!row) throw new ApiError(404, 'not_found', 'no such slot');
      return { meta: row.meta, state: row.state };
    },
    async listSlots() { return [...slots.values()].map((r) => r.meta); },
    async deleteSlot(slot) { slots.delete(slot); },
    async me() { return null; },
    async register() { throw new Error('unused'); },
    async login() { throw new Error('unused'); },
    async logout() {},
    async leaderboard() { return []; },
  } as unknown as Api;

  return {
    api,
    get putCount() { return putCount; },
    setOffline(v: boolean) { offline = v; },
    /** Simulate another device writing the slot. */
    writeFromElsewhere(slot: number, parkName: string, state: GameState) {
      const current = slots.get(slot)?.meta.revision ?? 0;
      slots.set(slot, { meta: metaFor(slot, parkName, current + 1, state), state });
    },
    peek(slot: number) { return slots.get(slot); },
  };
}

function harness(server = fakeServer()) {
  let state = createGameState();
  const statuses: SyncStatus[] = [];
  const conflicts: unknown[] = [];

  const engine = createSyncEngine({
    api: server.api,
    getState: () => state,
    applyState: (s) => { state = s; },
    getPlaytimeMs: () => 1000,
    events: {
      onStatus: (s) => statuses.push(s),
      onConflict: (c) => conflicts.push(c),
    },
  });

  return {
    engine, server, statuses, conflicts,
    get state() { return state; },
    setFunds(n: number) { state.funds = n; },
  };
}

test('a signed-out player stays local-only and never calls the server', async () => {
  const h = harness();
  h.engine.markDirty();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('local-only');
  expect(h.server.putCount).toBe(0);
});

test('a dirty park pushes and lands on synced', async () => {
  const h = harness();
  h.engine.attach(1, 'Dynamics Park', 0);

  h.setFunds(12345);
  h.engine.markDirty();
  expect(h.engine.status).toBe('dirty');

  await h.engine.pushNow();
  expect(h.engine.status).toBe('synced');
  expect(h.engine.isDirty).toBe(false);
  expect(h.server.peek(1)!.state.funds).toBe(12345);
  expect(h.server.peek(1)!.meta.revision).toBe(1);
});

test('a clean park does not push', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  await h.engine.pushNow();
  expect(h.server.putCount).toBe(0);
});

test('being offline keeps the park dirty rather than losing it', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.server.setOffline(true);

  h.setFunds(999);
  h.engine.markDirty();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('offline');
  expect(h.engine.isDirty).toBe(true);   // still pending, not discarded

  h.server.setOffline(false);
  await h.engine.pushNow();
  expect(h.engine.status).toBe('synced');
  expect(h.server.peek(1)!.state.funds).toBe(999);
});

test('another device writing first raises a conflict instead of clobbering', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);

  // Get to revision 1 from this device.
  h.setFunds(100);
  h.engine.markDirty();
  await h.engine.pushNow();

  // Another device pushes revision 2 while we were playing.
  const theirs = createGameState();
  theirs.funds = 777;
  theirs.dayCount = 42;
  h.server.writeFromElsewhere(1, 'Their Park', theirs);

  h.setFunds(200);
  h.engine.markDirty();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('conflict');
  expect(h.conflicts).toHaveLength(1);
  expect(h.engine.conflict!.remote.day).toBe(42);
  // Crucially, the other device's save is untouched.
  expect(h.server.peek(1)!.state.funds).toBe(777);
});

test('an unresolved conflict stops further pushes', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.engine.markDirty();
  await h.engine.pushNow();

  h.server.writeFromElsewhere(1, 'Theirs', createGameState());
  h.engine.markDirty();
  await h.engine.pushNow();
  expect(h.engine.status).toBe('conflict');

  const before = h.server.putCount;
  h.engine.markDirty();
  await h.engine.pushNow();
  await h.engine.pushNow();
  // No retry storm against a server that will keep saying 409.
  expect(h.server.putCount).toBe(before);
});

test('keepLocal overwrites the server copy', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.engine.markDirty();
  await h.engine.pushNow();

  h.server.writeFromElsewhere(1, 'Theirs', createGameState());
  h.setFunds(4242);
  h.engine.markDirty();
  await h.engine.pushNow();
  expect(h.engine.status).toBe('conflict');

  await h.engine.keepLocal();

  expect(h.engine.status).toBe('synced');
  expect(h.server.peek(1)!.state.funds).toBe(4242);
  expect(h.engine.conflict).toBeNull();
});

test('takeRemote replaces the live park with the server copy', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.engine.markDirty();
  await h.engine.pushNow();

  const theirs = createGameState();
  theirs.funds = 31337;
  theirs.dayCount = 12;
  h.server.writeFromElsewhere(1, 'Their Park', theirs);

  h.setFunds(5);
  h.engine.markDirty();
  await h.engine.pushNow();
  expect(h.engine.status).toBe('conflict');

  await h.engine.takeRemote();

  expect(h.engine.status).toBe('synced');
  expect(h.state.funds).toBe(31337);
  expect(h.state.dayCount).toBe(12);
  expect(h.engine.isDirty).toBe(false);
});

test('after takeRemote the next push builds on the right revision', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.engine.markDirty();
  await h.engine.pushNow();
  h.server.writeFromElsewhere(1, 'Theirs', createGameState());
  h.engine.markDirty();
  await h.engine.pushNow();
  await h.engine.takeRemote();

  // A follow-up edit must succeed, not conflict again.
  h.setFunds(60);
  h.engine.markDirty();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('synced');
  expect(h.server.peek(1)!.state.funds).toBe(60);
});

test('an expired session drops to local-only rather than erroring', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  // Replace saveSlot with one that 401s, as an expired cookie would.
  (h.server.api as any).saveSlot = async () => {
    throw new ApiError(401, 'unauthenticated', 'session expired');
  };

  h.engine.markDirty();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('local-only');
  expect(h.engine.slot).toBeNull();
});

test('detach stops syncing without losing the local park', async () => {
  const h = harness();
  h.engine.attach(1, 'Park', 0);
  h.setFunds(88);
  h.engine.markDirty();

  h.engine.detach();
  await h.engine.pushNow();

  expect(h.engine.status).toBe('local-only');
  expect(h.server.putCount).toBe(0);
  expect(h.state.funds).toBe(88);
});
