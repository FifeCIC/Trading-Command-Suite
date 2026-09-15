/**
 * apply-locale.js — the ONE place the notice locale is registered and switched.
 * ========================================================================
 * Created 2026-09-15 for #826 **Phase 6**.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The registry has always had the machinery for translation (`registerLocale` / `setNoticeLocale`)
 * and nothing ever called it. That is the repo's recurring defect: **a mechanism with no caller is
 * indistinguishable from no mechanism** — it looks supported and behaves like nothing is there.
 * This file is the caller, and the phrase to remember is that the seam was *exercised*, not
 * *documented*.
 *
 * ⚠️ REGISTRATION IS EAGER, SELECTION IS NOT.
 * Bundled locales are registered at import so the catalogue knows what exists; the *active* locale
 * always comes from the user's preference and defaults to English. Importing this module must never
 * change what a user sees — only `applyNoticeLocale()` may, and only with a value the user chose.
 *
 * WHERE IT IS CALLED FROM
 * -----------------------
 *   1. `src/main.jsx` — once at boot, so a stored preference survives a reload.
 *   2. `src/core/hooks/usePreferences.js` — inside `save()`, so every write path (the Settings
 *      control, server hydration, reset) applies immediately.
 *
 * ⚠️ Point 2 is the fix for a silent no-op: switching a language in Settings used to be able to
 * change the preference and leave every rendered message in the old language until a reload —
 * the same class of bug as the two competing market-tape preference stores (see usePreferences).
 * Because ALL writes funnel through `save()`, there is one place to get this right.
 */

// Bundled locales. Static imports (not a dynamic glob) so a bundler includes exactly these and a
// typo is a build error rather than a runtime "locale not found" that silently does nothing.
import de from './locales/de.js';
import { registerLocale, setNoticeLocale, getNoticeLocale } from './registry.js';

/**
 * The locales that exist, in the order a language picker should show them.
 * `id` is what `applyNoticeLocale` takes and what the `noticeLocale` preference stores.
 */
export const AVAILABLE_LOCALES = [
  { id: 'en', label: 'English', native: 'English', translated: 'source language' },
  { id: 'de', label: 'German', native: 'Deutsch', translated: 'partial — falls back to English per field' },
];

const BUNDLES = { de };

let registered = false;

/** Register every bundled locale. Idempotent; safe to call from more than one entry point. */
export function registerBundledLocales() {
  if (registered) return;
  for (const [id, bundle] of Object.entries(BUNDLES)) registerLocale(id, bundle);
  registered = true;
}

/**
 * Make a locale active. An unknown id falls back to 'en' rather than leaving the registry in a
 * state where nothing resolves — an unrecognised preference must degrade, never blank the UI.
 */
export function applyNoticeLocale(localeId) {
  registerBundledLocales();
  const id = AVAILABLE_LOCALES.some((l) => l.id === localeId) ? localeId : 'en';
  setNoticeLocale(id);
  return id;
}

export { getNoticeLocale };
