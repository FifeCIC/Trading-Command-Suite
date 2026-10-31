/**
 * Direct-route pages — the import surface for pages served by LITERAL routes in App.jsx.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * App.jsx serves four pages at literal paths (`/lab/top-movers`, `/settings/data-management`,
 * `/settings/health-check`, `/lab/platform-comparisons`) outside the `/:area/:view` registry.
 * Keeping them behind one module means the route table names a single import surface rather than
 * four separate page files, and a `null` export is a supported way to skip a route without
 * deleting the page.
 *
 * ⚠️ THIS USED TO BE AN EDITION SEAM. A Vite alias swapped this module for
 * `src/editions/direct-pages.free.jsx` in "free" mode, where `null` meant "premium, do not ship".
 * The free edition was cancelled 2026-10-28 (SETTLED-DECISIONS row 96) and the alias is gone — all
 * four pages are always exported. The `null` guard in App.jsx remains as a harmless no-op.
 */
export { default as DataManagementPage } from '../pages/DataManagementPage';
export { default as TopMoversPage } from '../pages/TopMoversPage';
export { default as SystemHealthPage } from '../pages/SystemHealthPage';
export { default as PlatformComparisonsPage } from '../pages/PlatformComparisonsPage';
