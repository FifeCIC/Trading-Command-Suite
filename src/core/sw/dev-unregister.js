/**
 * dev-unregister.js — in DEV, evict a service worker left behind by a built edition.
 * ================================================================================
 *
 * ⚠️ WHY THIS EXISTS (2026-11-18, measured the hard way). `vite preview` serves a BUILT edition on the
 * same origin as the dev server (5173), and that build registers a Workbox service worker. Its
 * navigation fallback then answers EVERY page on the origin from the precache — so the dev server is
 * never consulted again.
 *
 * The symptom is not a warning. Every route sits on its Suspense fallback forever, because the dynamic
 * `import()`s resolve against precached chunk names from a build that may no longer exist. It reads as
 * "the app is broken", and it cost most of a session: the production build was found to hang
 * IDENTICALLY, which is what finally identified the worker rather than the code.
 *
 * ⚠️ `registerSW()` IN `main.jsx` DOES NOT HELP. `virtual:pwa-register` is a no-op in dev, so it neither
 * registers nor cleans up — a leftover worker keeps control indefinitely.
 *
 * ⚠️ DEV ONLY, AND IT RELOADS AT MOST ONCE. The guard is `sessionStorage`, not a module variable: a
 * reload restarts the module, so a module variable would loop forever on a worker that refuses to go.
 */

const FLAG = 'tcs:dev-sw-evicted';

/**
 * Unregister any service worker controlling this origin, clear its caches, and reload once so the page
 * is fetched from the dev server again.
 *
 * Fire-and-forget by design: the caller is the app entry, and nothing should wait on it.
 */
export function evictDevServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // ⚠️ The test is `controller`, not `getRegistrations()`. A registration that exists but does not
  // control THIS page cannot be breaking it, and reporting it as a fault would be a false alarm.
  if (!navigator.serviceWorker.controller) return;

  // Already tried in this tab: a second attempt would reload again, and a worker that will not go
  // would then produce an infinite reload loop.
  try {
    if (sessionStorage.getItem(FLAG) === '1') return;
    sessionStorage.setItem(FLAG, '1');
  } catch {
    /* Storage blocked: better to do nothing than to risk a reload loop. */
    return;
  }

  (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* Whatever failed, the reload below is still the right next move. */
    }
    console.warn(
      '[dev] A service worker from a built edition was controlling this origin — it has been removed '
      + 'and the page is reloading so Vite serves it again. Use a different port for `vite preview`.',
    );
    window.location.reload();
  })();
}

export default evictDevServiceWorker;
