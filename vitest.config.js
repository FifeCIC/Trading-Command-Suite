/**
 * vitest.config.js — the COMPONENT test runner.
 *
 * ⚠️ SEPARATE FROM `vite.config.js` ON PURPOSE, and vitest prefers this file when both exist. The app
 * config carries `vite-plugin-pwa`, which rewrites the service worker and the precache manifest — work
 * that has no business happening in a DOM test, and which fails outside a production build.
 *
 * ⚠️ `include` IS `*.test.jsx` ONLY. The 38 frontend tests in `src/core/` are `node --test` files using
 * `node:test` and `node:assert`; vitest would collect them and fail on the imports. Two runners, two
 * file patterns, no overlap.
 *
 * ⚠️ `globals: false`. With globals on, every spec's `describe`/`it`/`expect` becomes an undeclared
 * identifier as far as `scripts/validate-lint.cjs` (isolated config, `no-undef`) is concerned — so the
 * gate would collect them as new findings the day the runner arrived. Specs import from `vitest`
 * explicitly instead, and `cleanup()` is called in an `afterEach` rather than relying on RTL's implicit
 * auto-cleanup (which needs a global `afterEach` to exist).
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      `vitest` + `@testing-library/react` + `jsdom` are frontend devDependencies, one config
 *            (`vitest.config.js`), one include pattern (a `*.test.jsx` under `src`), and the suite runs in
 *            `prebuild`. Component specs live beside their component.
 * WHY:       There was no component test runner at all: 3 of 117 components were named in any test and
 *            26 of 28 primitives had none. The three most-reused carry 162 call sites. The owner's
 *            component-framework proposal was measured first, and the missing third of the trio was
 *            testing — not widgets.
 * INSTEAD OF: Adding a framework or moving components into a library folder. The catalogue measured
 *            reuse as bimodal (28 primitive / 60 shared / 29 single, 0 orphan), so the widgets already
 *            exist; what did not exist was a way to prove one still works.
 * REVERSE BY: Delete this file, the three `*.test.jsx` specs, the `test:components*` scripts and the
 *            `vitest run` step in `prebuild`; remove the devDependencies; drop the `component-tests`
 *            entry from `src/data/standards.js`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 307
 * GUARD:     npm run test:components:self-test   (mutates each component and requires the spec to fail)
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx'],
    globals: false,
    restoreMocks: true,
    reporters: 'default',
  },
});
