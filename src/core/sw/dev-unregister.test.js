/**
 * dev-unregister.test.js — the dev service-worker eviction, proved in both directions.
 *
 * ⚠️ The failure this guards is a WEDGED DEV SERVER: a leftover Workbox worker answers every
 * navigation from its precache, so the dev server is never consulted and every route sits on its
 * Suspense fallback forever. It reads as "the app is broken" and there is no error message.
 *
 * ⚠️ The reload path is stubbed, so this proves the DECISION (evict and reload once, never twice), not
 * that a real worker unregisters — that needs a browser, and the state is awkward to recreate on demand.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { evictDevServiceWorker } from './dev-unregister.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function stubWorld({ controlled, alreadyFlagged = false }) {
  const calls = { unregister: 0, cacheDelete: 0, reload: 0, flagged: alreadyFlagged };
  const store = new Map(alreadyFlagged ? [['tcs:dev-sw-evicted', '1']] : []);

  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  globalThis.caches = {
    keys: async () => ['workbox-precache'],
    delete: async () => { calls.cacheDelete += 1; return true; },
  };
  globalThis.navigator = {
    serviceWorker: {
      controller: controlled ? {} : null,
      getRegistrations: async () => [{ unregister: async () => { calls.unregister += 1; return true; } }],
    },
  };
  globalThis.window = { location: { reload: () => { calls.reload += 1; } } };
  return { calls, store };
}

beforeEach(() => {
  delete globalThis.sessionStorage;
  delete globalThis.caches;
  delete globalThis.navigator;
  delete globalThis.window;
});

test('no controlling worker means no action — a registration that controls nothing is not a fault', async () => {
  const { calls } = stubWorld({ controlled: false });
  evictDevServiceWorker();
  await flush();
  assert.equal(calls.unregister, 0);
  assert.equal(calls.reload, 0);
});

test('a controlling worker is unregistered, its caches cleared, and the page reloaded once', async () => {
  const { calls, store } = stubWorld({ controlled: true });
  evictDevServiceWorker();
  await flush();
  await flush();
  assert.equal(calls.unregister, 1);
  assert.equal(calls.cacheDelete, 1, 'the precache must go too, or the next load is served from it');
  assert.equal(calls.reload, 1);
  assert.equal(store.get('tcs:dev-sw-evicted'), '1', 'the one-shot flag is stamped before the reload');
});

test('the second call in the same tab does nothing — a worker that will not go must not reload forever', async () => {
  const { calls } = stubWorld({ controlled: true, alreadyFlagged: true });
  evictDevServiceWorker();
  await flush();
  await flush();
  assert.equal(calls.unregister, 0);
  assert.equal(calls.reload, 0);
});

test('a hostile environment does not throw — the app entry must survive', async () => {
  // No navigator at all (SSR / a test runner): must simply return.
  evictDevServiceWorker();
});
