/**
 * dev-unregister.test.js — the dev service-worker eviction, proved in both directions.
 *
 * ⚠️ The failure this guards is a WEDGED DEV SERVER: a leftover Workbox worker answers every
 * navigation from its precache, so the dev server is never consulted and the app runs a cached build.
 * It reads as "the app is broken" and there is no error message.
 *
 * ⚠️ The reload path is stubbed, so this proves the DECISION, not that a real worker unregisters — that
 * needs a browser, and the state is awkward to recreate on demand.
 *
 * ⚠️ ADDED 2026-11-19, after the one-shot flag was measured wrong: the guard must be a WINDOW, not a
 * boolean. A permanent flag meant a re-registered worker (or a duplicated tab, which inherits
 * `sessionStorage`) was never evicted again, and the stale menu it served was blamed on the app.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { evictDevServiceWorker } from './dev-unregister.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

const STAMP = 'tcs:dev-sw-evicted-at';

function stubWorld({ controlled, flaggedAgoMs = null, withListener = false } = {}) {
  const calls = { unregister: 0, cacheDelete: 0, reload: 0, listenerAdds: 0, notices: 0 };
  const store = new Map(flaggedAgoMs === null ? [] : [[STAMP, String(Date.now() - flaggedAgoMs)]]);

  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  globalThis.caches = {
    keys: async () => ['workbox-precache'],
    delete: async () => { calls.cacheDelete += 1; return true; },
  };
  const serviceWorker = {
    controller: controlled ? {} : null,
    getRegistrations: async () => [{ unregister: async () => { calls.unregister += 1; return true; } }],
  };
  if (withListener) {
    serviceWorker.addEventListener = () => { calls.listenerAdds += 1; };
  }
  globalThis.navigator = { serviceWorker };
  globalThis.window = { location: { reload: () => { calls.reload += 1; } } };

  // Minimal document: enough to record that a notice was appended, and to prove it is not duplicated.
  const appended = new Map();
  globalThis.document = {
    getElementById: (id) => appended.get(id) ?? null,
    createElement: () => ({ id: '', setAttribute() {}, style: {}, textContent: '' }),
    body: { appendChild: (el) => { appended.set(el.id, el); calls.notices += 1; } },
  };

  return { calls, store };
}

beforeEach(() => {
  delete globalThis.sessionStorage;
  delete globalThis.caches;
  delete globalThis.navigator;
  delete globalThis.window;
  delete globalThis.document;
});

test('no controlling worker means no action — a registration that controls nothing is not a fault', async () => {
  const { calls } = stubWorld({ controlled: false });
  evictDevServiceWorker();
  await flush();
  assert.equal(calls.unregister, 0);
  assert.equal(calls.reload, 0);
  assert.equal(calls.notices, 0);
});

test('an uncontrolled page subscribes to controllerchange — a worker that claims LATER is still caught', async () => {
  const { calls } = stubWorld({ controlled: false, withListener: true });
  evictDevServiceWorker();
  await flush();
  assert.equal(calls.listenerAdds, 1);
  assert.equal(calls.reload, 0, 'nothing to evict yet');
});

test('a controlling worker is unregistered, its caches cleared, and the page reloaded once', async () => {
  const { calls, store } = stubWorld({ controlled: true });
  evictDevServiceWorker();
  await flush();
  await flush();
  assert.equal(calls.unregister, 1);
  assert.equal(calls.cacheDelete, 1, 'the precache must go too, or the next load is served from it');
  assert.equal(calls.reload, 1);
  assert.ok(Number(store.get(STAMP)) > 0, 'the attempt is stamped as a TIMESTAMP before the reload');
});

test('an attempt moments ago does not reload again — a worker that will not go must not loop', async () => {
  const { calls } = stubWorld({ controlled: true, flaggedAgoMs: 500 });
  evictDevServiceWorker();
  await flush();
  await flush();
  assert.equal(calls.unregister, 0);
  assert.equal(calls.reload, 0);
});

test('…and it SHOWS a notice instead of looking healthy — the wedged state is never silent', async () => {
  const { calls } = stubWorld({ controlled: true, flaggedAgoMs: 500 });
  evictDevServiceWorker();
  await flush();
  assert.equal(calls.notices, 1);

  // A second call must not stack a second banner.
  evictDevServiceWorker();
  await flush();
  assert.equal(calls.notices, 1);
});

test('an attempt older than the window evicts again — a re-registered worker is not permanent', async () => {
  const { calls } = stubWorld({ controlled: true, flaggedAgoMs: 60_000 });
  evictDevServiceWorker();
  await flush();
  await flush();
  assert.equal(calls.unregister, 1, 'a stale stamp must not disarm the guard (the measured defect)');
  assert.equal(calls.reload, 1);
  assert.equal(calls.notices, 0);
});

test('a hostile environment does not throw — the app entry must survive', async () => {
  // No navigator at all (SSR / a test runner): must simply return.
  evictDevServiceWorker();
});
