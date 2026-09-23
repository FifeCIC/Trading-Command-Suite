/**
 * Direct-route pages — the import surface for pages served by LITERAL routes in App.jsx.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * App.jsx serves four pages at literal paths (`/lab/top-movers`, `/settings/data-management`,
 * `/settings/health-check`, `/lab/platform-comparisons`) outside the `/:area/:view` registry.
 * A direct static import ships that page into EVERY build — including the free edition, which
 * must PHYSICALLY exclude premium page code (the shipped JS is readable; FREE-EDITION-PLAN.md
 * §3/§4 — "hidden is not absent").
 *
 * The free build swaps this module for `src/editions/direct-pages.free.jsx` (Vite alias, mode
 * `free`). A `null` export there means the page is premium: App.jsx skips the route and the
 * page code never enters the bundle.
 *
 * Adding a page here? Decide its edition and mirror the decision in the free variant —
 * `scripts/validate-free-bundle.cjs` checks tiered registry pages, not this list.
 */
export { default as DataManagementPage } from '../pages/DataManagementPage';
export { default as TopMoversPage } from '../pages/TopMoversPage';
export { default as SystemHealthPage } from '../pages/SystemHealthPage';
export { default as PlatformComparisonsPage } from '../pages/PlatformComparisonsPage';
