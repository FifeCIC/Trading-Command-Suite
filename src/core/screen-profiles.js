/**
 * Screen profiles — the multi-screen cockpit seam (epic #746, phase 3)
 * ===================================================================
 * A **screen profile** answers one question: *which board should each physical
 * monitor show?*
 *
 *   {
 *     v: 1,
 *     assignments: {                       // screenKey → boardId
 *       'p-2560x1440-0,0':   'dashboard',  // the primary monitor
 *       's-1920x1080-2560,0': 'lab',       // a second monitor to the right
 *     },
 *   }
 *
 * WHAT THIS FILE DOES
 * -------------------
 * 1. **Detection** (`detectScreens`) — reads the Window Management API
 *    (`window.getScreenDetails()`), falling back to the single screen exposed by
 *    `window.screen` when the API is missing or the permission is refused.
 * 2. **Geometry** (`screenWindowFeatures`, `spanWindowFeatures`) — turns a screen
 *    into a `window.open()` feature string. Pure functions so the maths can be
 *    tested without a second monitor.
 * 3. **Persistence** (`loadScreenProfile` / `saveScreenProfile`) — the same
 *    versioned-document pattern as the board store, so moving this server-side
 *    later is a swap, not a rewrite.
 *
 * WHY THE WINDOW MANAGEMENT API NEEDS A USER GESTURE
 * --------------------------------------------------
 * Chromium gates `getScreenDetails()` behind the `window-management` permission.
 * Calling it on mount is unreliable — the promise rejects with `NotAllowedError`
 * unless the document is focused and the user has granted (or is granting) the
 * permission. So the cockpit exposes an explicit "Detect screens" button and
 * treats a refusal as a normal state, not an error: with one screen you still
 * get a usable cockpit (the board fills the monitor; "open on screen" uses the
 * single screen).
 *
 * WHY SCREEN KEYS ARE POSITIONAL
 * ------------------------------
 * The API gives no stable display identifier, so a key is derived from what the
 * browser does expose: `p|s` (primary or not), resolution, and desktop origin.
 * Moving a monitor to a different position or changing its resolution re-keys it,
 * so that screen's assignment falls back to the unassigned state. That is
 * acceptable for a local cockpit (and honest — the alternative would be
 * pretending the browser gave us a display id it did not).
 */

const PROFILE_KEY = 'tcs:view-state:screen-profile:default';
const PROFILE_VERSION = 1;

/** Where a single board is rendered full-bleed for one monitor. */
export const SCREEN_BOARD_ROUTE = '/dashboard/screen';

/**
 * How long to wait for the Window Management API before falling back.
 *
 * ⚠️ MEASURED 2026-09-10: `getScreenDetails()` can neither resolve NOR reject
 * while the document is unfocused (e.g. a background tab, or a hidden window
 * during automated testing) — the promise simply never settles. Without a race
 * the cockpit sits on "Detecting…" forever with nothing to click, so detection
 * is always raced against this timeout and a timeout is a normal result.
 */
export const SCREEN_DETECT_TIMEOUT_MS = 4000;

/** Cross-window bus: the cockpit and each screen window talk over this channel. */
export const SCREEN_CHANNEL = 'tcs:screens';

/** Stable-enough key for a detected screen. See the note at the top of the file. */
export function screenKey(screen, index = 0) {
  const origin = `${Math.round(screen.left ?? 0)},${Math.round(screen.top ?? 0)}`;
  const size = `${Math.round(screen.width ?? 0)}x${Math.round(screen.height ?? 0)}`;
  return `${screen.isPrimary ? 'p' : 's'}-${size}-${origin}-${index}`;
}

/** `window.open()` target name — one window per screen, reused if reopened. */
export const windowNameFor = (key) => `tcs-screen-${key}`;

/** URL a screen window loads. */
export const screenWindowUrl = (boardId) =>
  `${SCREEN_BOARD_ROUTE}?board=${encodeURIComponent(boardId)}`;

/** The single screen the browser always exposes, used as the fallback. */
export function fallbackScreens() {
  if (typeof window === 'undefined' || !window.screen) return [];
  const s = window.screen;
  const screen = {
    index: 0,
    key: screenKey({ isPrimary: true, width: s.width, height: s.height, left: 0, top: 0 }, 0),
    label: 'This screen',
    width: s.width,
    height: s.height,
    left: 0,
    top: 0,
    availWidth: s.availWidth,
    availHeight: s.availHeight,
    availLeft: 0,
    availTop: 0,
    isPrimary: true,
  };
  return [screen];
}

/**
 * detectScreens() → { supported, permission, screens, error? }
 * `permission` is one of 'granted' | 'denied' | 'timeout' | 'unsupported' | 'error'.
 * Never throws, and never waits longer than SCREEN_DETECT_TIMEOUT_MS — a refused
 * or unanswered permission is a supported-but-degraded state, not a failure.
 */
export async function detectScreens() {
  if (typeof window === 'undefined' || typeof window.getScreenDetails !== 'function') {
    return { supported: false, permission: 'unsupported', screens: fallbackScreens() };
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Window Management API did not answer in time');
      err.name = 'TimeoutError';
      reject(err);
    }, SCREEN_DETECT_TIMEOUT_MS);
  });
  try {
    const details = await Promise.race([window.getScreenDetails(), timeout]);
    const screens = details.screens.map((s, index) => ({
      index,
      key: screenKey(s, index),
      label: s.label || `Screen ${index + 1}`,
      width: s.width,
      height: s.height,
      left: s.left,
      top: s.top,
      availWidth: s.availWidth,
      availHeight: s.availHeight,
      availLeft: s.availLeft,
      availTop: s.availTop,
      isPrimary: s.isPrimary,
      isInternal: s.isInternal,
    }));
    return { supported: true, permission: 'granted', screens };
  } catch (err) {
    const name = err?.name || 'Error';
    const permission = name === 'NotAllowedError' ? 'denied'
      : name === 'TimeoutError' ? 'timeout'
      : 'error';
    return { supported: true, permission, screens: fallbackScreens(), error: name };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * screenWindowFeatures(screen) → `window.open()` feature string.
 * Uses the *available* area (excludes the OS taskbar) so a screen window does
 * not open underneath it. Pure — no DOM access — so this can be unit-checked.
 */
export function screenWindowFeatures(screen) {
  const width = Math.round(screen.availWidth ?? screen.width ?? 0);
  const height = Math.round(screen.availHeight ?? screen.height ?? 0);
  const left = Math.round(screen.availLeft ?? screen.left ?? 0);
  const top = Math.round(screen.availTop ?? screen.top ?? 0);
  return [
    `left=${left}`,
    `top=${top}`,
    `width=${width}`,
    `height=${height}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
  ].join(',');
}

/**
 * spanWindowFeatures(screens) → feature string covering the bounding box of all
 * screens. This is the "one window across everything" fallback for browsers that
 * refuse per-monitor placement (and the shape the old triple-screen prototype
 * used).
 */
export function spanWindowFeatures(screens) {
  const list = Array.isArray(screens) && screens.length ? screens : fallbackScreens();
  if (!list.length) return 'menubar=no,toolbar=no';
  const left = Math.min(...list.map((s) => Math.round(s.left ?? 0)));
  const top = Math.min(...list.map((s) => Math.round(s.top ?? 0)));
  const right = Math.max(...list.map((s) => Math.round((s.left ?? 0) + (s.width ?? 0))));
  const bottom = Math.max(...list.map((s) => Math.round((s.top ?? 0) + (s.height ?? 0))));
  return [
    `left=${left}`,
    `top=${top}`,
    `width=${Math.max(1, right - left)}`,
    `height=${Math.max(1, bottom - top)}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
  ].join(',');
}

/** `Screen 1 · 2560×1440 · primary` — one line for the cockpit table. */
export function describeScreen(screen) {
  const size = `${Math.round(screen.width ?? 0)}×${Math.round(screen.height ?? 0)}`;
  const at = `${Math.round(screen.left ?? 0)},${Math.round(screen.top ?? 0)}`;
  const tags = [screen.isPrimary ? 'primary' : 'secondary', `at ${at}`];
  if (screen.isInternal) tags.push('internal');
  return `${size} · ${tags.join(' · ')}`;
}

const safeParse = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Migrate any stored profile to the current version (single step today). */
function migrate(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.v === PROFILE_VERSION && doc.assignments && typeof doc.assignments === 'object') return doc;
  return null;
}

/**
 * loadScreenProfile() → { v, assignments }
 * Always returns a usable object; an unreadable document reads as "nothing
 * assigned" rather than throwing during render.
 */
export function loadScreenProfile() {
  if (typeof localStorage === 'undefined') return { v: PROFILE_VERSION, assignments: {} };
  const stored = migrate(safeParse(localStorage.getItem(PROFILE_KEY)));
  return stored || { v: PROFILE_VERSION, assignments: {} };
}

export function saveScreenProfile(profile) {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ v: PROFILE_VERSION, assignments: profile?.assignments || {} })
    );
  } catch { /* quota / no storage */ }
}

/**
 * subscribeScreenProfile(onChange) → unsubscribe.
 * Cross-window sync, same reasoning as `subscribeBoard`: with a cockpit open on
 * one monitor and a board window on another, reassigning a screen here must not
 * leave the other window showing a stale label.
 */
export function subscribeScreenProfile(onChange) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event) => {
    if (event.key !== PROFILE_KEY || event.newValue == null) return;
    const next = migrate(safeParse(event.newValue));
    if (next) onChange(next);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/**
 * openScreenWindow(screen, boardId, { span }) → Window | null
 * Opens (or focuses, via the named target) the screen window for a monitor.
 * Returns null when the browser blocks the popup — callers show that as a state,
 * because a blocked popup is a normal browser decision, not a crash.
 */
export function openScreenWindow(screen, boardId, { span = false } = {}) {
  if (typeof window === 'undefined') return null;
  const features = span ? spanWindowFeatures([screen]) : screenWindowFeatures(screen);
  return window.open(screenWindowUrl(boardId), windowNameFor(screen.key), features);
}
