/**
 * Direct-route pages — FREE EDITION variant (swapped in by the Vite alias, mode `free`).
 *
 * All four current direct-route pages are premium or untiered:
 *   - PlatformComparisonsPage — premium; its registry route (/status/platform-comparisons) is
 *     tiered premium, so /lab/platform-comparisons simply does not exist in the free edition.
 *   - DataManagementPage, SystemHealthPage, TopMoversPage — untiered legacy direct routes;
 *     they stay out of the free edition until someone tiers and imports them deliberately.
 *
 * `null` makes App.jsx skip the route and keeps the page code OUT of the bundle entirely.
 */
export const DataManagementPage = null;
export const TopMoversPage = null;
export const SystemHealthPage = null;
export const PlatformComparisonsPage = null;
