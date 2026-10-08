/**
 * page-width — the "how wide should this page render" preference, shared by the page that APPLIES it
 * and the Screen Options registry that OFFERS it.
 *
 * ⚠️ WHY A SHARED MODULE (2026-10-08). The control used to be an in-page bar on Manual Trading
 * (`.mt5u-layout-bar`), which put a page-layout preference somewhere different from every other
 * page's settings. Moving it into the global Screen Options rail made the storage key load-bearing
 * across TWO files: the registry writes it, the page reads it. A second literal for that key is how a
 * control silently stops working — the registry writes `mt5-page-width`, the page reads something
 * else, nothing errors, and the width simply never changes. One module means one key.
 *
 * ⚠️ `maxWidth: 'none'` IS A REAL VALUE, not a missing one — it is what "Full Width" means. Do not
 * "fix" it to a number; the page applies it directly as a CSS custom property.
 */
export const PAGE_WIDTH_STORAGE_KEY = 'mt5-page-width';

export const PAGE_WIDTHS = {
  full: { label: 'Full Width', desc: 'Use all available screen width', maxWidth: 'none' },
  '4k': { label: '4K', desc: 'Max width 2560px', maxWidth: '2560px' },
  desktop: { label: 'Desktop', desc: 'Max width 1440px — default', maxWidth: '1440px' },
  laptop: { label: 'Laptop', desc: 'Max width 1200px', maxWidth: '1200px' },
  tablet: { label: 'Tablet', desc: 'Max width 960px', maxWidth: '960px' },
};

export const DEFAULT_PAGE_WIDTH = 'desktop';

/**
 * readPageWidth() — the stored preference, or the default.
 *
 * ⚠️ Falls back for a MISSING **and an UNRECOGNISED** value. A stale key from a removed option would
 * otherwise resolve to `undefined`, and `PAGE_WIDTHS[undefined].maxWidth` throws — a blank page
 * caused by a preference, which reads as a broken build rather than a bad setting.
 */
export function readPageWidth() {
  try {
    const v = localStorage.getItem(PAGE_WIDTH_STORAGE_KEY);
    return v && PAGE_WIDTHS[v] ? v : DEFAULT_PAGE_WIDTH;
  } catch {
    return DEFAULT_PAGE_WIDTH;
  }
}
