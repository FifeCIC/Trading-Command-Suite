/**
 * theme-cards — the display metadata for every theme pack.
 * =========================================================
 * ⚠️ THIS LIVES IN ITS OWN MODULE, NOT IN App.jsx (2026-10-13).
 * It was declared inside App.jsx, where only the shell used it. The Appearance area now needs the same
 * list, and importing it from App.jsx would have created a CYCLE — App.jsx imports the chooser
 * component, and the chooser would import App.jsx back. A cycle like that resolves to `undefined` at
 * module-evaluation time, so the failure is a blank pack chooser with no error, which is the exact
 * shape of bug this repo keeps re-finding. The list moved here instead, and both consumers import it.
 *
 * ⚠️ `id` MUST match a registered pack id. Packs are discovered at runtime from `theme/packs/*.js`
 * (`theme/loader.js`), so a card whose id has no pack renders a control that does nothing. When the
 * `ai-original` pack was deleted its card had to be removed in the same change for this reason.
 *
 * ⚠️ `colors` is [background, accent, foreground] — the three colours a pack sets, used for the card
 * swatch. A pack carries COLOURS ONLY: it must not change padding, size, spacing or layout. The
 * deleted `ai-original` pack carried ~80 structural overrides, so the app's geometry depended on the
 * colour scheme that happened to be active; that is the mistake this separation exists to prevent.
 */

/** The default pack. Also the runtime fallback in `theme/registry.js` and the store default. */
export const DEFAULT_THEME_PACK = 'slate';

export const THEME_CARDS = [
  { id: 'slate', name: 'Slate', description: 'Blue-gray with indigo accent — matches the dashboard.', colors: ['#0f172a', '#3b82f6', '#e2e8f0'] },
  { id: 'core', name: 'Core', description: 'Clean, neutral palette.', colors: ['#f4f7fb', '#0ea5a6', '#0f172a'] },
  { id: 'oceanic', name: 'Oceanic', description: 'Deep blue with teal.', colors: ['#0f1b2e', '#00d9ff', '#d6e8ff'] },
  { id: 'scifi', name: 'Sci-Fi', description: 'Dark navy, cyan neon.', colors: ['#0a1428', '#00d9ff', '#c1d0e0'] },
  { id: 'terminal', name: 'Terminal', description: 'Black, neon green.', colors: ['#0a0a0a', '#00ff41', '#e0e0e0'] },
  { id: 'void', name: 'Void', description: 'Black, neon purple.', colors: ['#08080d', '#8a50ff', '#d4d0e8'] },
];
