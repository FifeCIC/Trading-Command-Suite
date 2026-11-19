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
 *
 * ── SECOND MEASUREMENT, 2026-11-19: the ONE-SHOT flag was wrong, and it hid this same fault again ──
 *
 * The guard was a permanent per-tab flag (`tcs:dev-sw-evicted=1`). That is correct for the reload loop
 * it was written for, and wrong for every later case:
 *
 *   • a worker that RE-REGISTERS after the eviction (running `vite preview` again) is never evicted
 *     a second time in that tab;
 *   • **a DUPLICATED tab INHERITS `sessionStorage`**, so it starts already "done" and serves the stale
 *     build from the first paint. That is exactly "the Strategies and Bots areas appear only after a
 *     hard reload and vanish on a normal one": a hard reload bypasses the worker for that one
 *     navigation, a normal refresh is answered from the precache.
 *
 * Nothing in the app was wrong in that report — the source, the live module and the dev server all
 * carried the new nav tree. **A one-shot that cannot fire twice is indistinguishable from no guard.**
 *
 * ⇒ The flag is now a TIMESTAMP with a short window: it still cannot loop (a reloaded page re-runs this
 *   module immediately) but a later re-registration or an inherited tab is still caught.
 *
 * ⚠️ AND THE WEDGED CASE IS NOW VISIBLE. If a controller survives an eviction attempt the page says so
 * instead of running a stale build in silence — "cannot judge" rendered as "fine" is the defect §7 of
 * `development-philosophy` names.
 */

/** Session stamp of the last eviction attempt — a timestamp, deliberately not a boolean. */
const STAMP = 'tcs:dev-sw-evicted-at';

/**
 * ⚠️ The loop guard. A reload re-executes this module within a few hundred ms, so anything above a
 * second prevents a loop; 20 s is chosen so a duplicate tab opened later in the same session is still
 * caught. Lowering it is safe; removing it is not.
 */
const GUARD_MS = 20_000;

const NOTICE_ID = 'tcs-dev-sw-notice';

/** True when an attempt was made recently enough that reloading again would risk a loop. */
function attemptedRecently() {
  try {
    const at = Number(sessionStorage.getItem(STAMP));
    return Number.isFinite(at) && at > 0 && Date.now() - at < GUARD_MS;
  } catch {
    // Storage blocked: assume "recently", so a hostile environment can never produce a reload loop.
    return true;
  }
}

/**
 * Render a persistent, self-explanatory notice. Reached ONLY when eviction did not take: a page that
 * loaded with no controller takes the listener branch and a successful eviction reloads, so a healthy
 * dev tab can never show this.
 */
function showWedgedNotice() {
  if (typeof document === 'undefined' || document.getElementById(NOTICE_ID)) return;
  const el = document.createElement('div');
  el.id = NOTICE_ID;
  el.setAttribute('role', 'status');
  el.textContent = 'This tab is running a CACHED build, not the dev server (a service worker from an '
    + 'earlier `vite preview` still controls it). Close every tab on this origin, or use Ctrl+Shift+R.';
  el.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;bottom:0;padding:10px 14px;'
    + 'font:600 13px/1.4 system-ui,sans-serif;background:#7f1d1d;color:#fff;text-align:center;';
  document.body.appendChild(el);
}

/**
 * Unregister any service worker controlling this origin, clear its caches, and reload once so the page
 * is fetched from the dev server again.
 *
 * Fire-and-forget by design: the caller is the app entry, and nothing should wait on it.
 */
export function evictDevServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const sw = navigator.serviceWorker;

  // ⚠️ The test is `controller`, not `getRegistrations()`. A registration that exists but does not
  // control THIS page cannot be breaking it, and reporting it as a fault would be a false alarm.
  if (!sw.controller) {
    // A worker can also CLAIM this page after the check (Workbox `clientsClaim`). Without this the tab
    // would switch to precached assets mid-session — the same fault, arriving late.
    if (typeof sw.addEventListener === 'function') {
      sw.addEventListener('controllerchange', () => evictDevServiceWorker(), { once: true });
    }
    return;
  }

  // Already tried, and the worker is STILL in control. Reloading again would loop, so say so instead.
  if (attemptedRecently()) {
    showWedgedNotice();
    return;
  }

  try {
    sessionStorage.setItem(STAMP, String(Date.now()));
  } catch {
    /* Storage blocked — attemptedRecently() then reports "recently" and nothing can loop. */
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
