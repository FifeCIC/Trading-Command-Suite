import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * ⚠️ KEPT AS A LESSON, DELIBERATELY — the free-edition build mode that lived here was removed
 * 2026-10-28 when the app became open-source (see FREE-EDITION-PLAN.md's superseded banner).
 * The mechanism is gone; the two traps it cost are not, and they apply to ANY future
 * per-build-flavour module swap:
 *
 *   1. `resolve.alias` CANNOT do a tail-matching swap. Consumers import the same module at
 *      different depths (`./core/nav-tree` from App.jsx, `../core/nav-tree` from Breadcrumbs),
 *      so the match must be a regex on the specifier TAIL — and this repo builds with rolldown,
 *      whose alias does NOT expand `$1` in `replacement`. The first attempt produced the literal
 *      `$1core/nav-tree.free.js` and the build failed with "The system cannot find the file
 *      specified." An explicit `resolveId` hook has no such ambiguity.
 *   2. Match on the BASENAME with the extension stripped. Imports are written both ways
 *      (`./core/nav-tree` and `../core/nav-tree.js`), and requiring an extension silently matched
 *      only half of them — which is how the first version of the plugin let three modules through.
 *
 * And the general rule those two cost: a swap that misses must fail LOUDLY. The removed guard
 * asserted the unfiltered module was absent from the shipped bundle rather than trusting the hook.
 */

/** Local dev API/intranet proxy — shared by the dev server and `vite preview`. */
const localProxy = {
  '/intranet': {
    target: 'http://localhost',
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:3201',
    changeOrigin: true,
  },
};

export default defineConfig(() => {
  return {
  // ⚠️ NO `css.lightningcss` SETTING HERE, DELIBERATELY (removed 2026-11-15). `css.lightningcss`
  // controls CSS *transforms* (nesting, custom media) and defaults to `false` — it was never what
  // minified the bundle. Leaving `lightningcss: false` here read as "lightningcss is off" while
  // `build.cssMinify: 'lightningcss'` a few lines below turned it ON, which is exactly the sort of
  // contradiction that sends the next reader looking in the wrong place.
  build: {
    // ── DECISION (2026-11-15, primary) ──
    // WHAT:      CSS minification is ON (`lightningcss`), and this must not be turned off.
    // WHY:       It was `false` with the comment "lightningcss is too strict — disable CSS
    //            minification for now". The minifier was not too strict: **20 stylesheets in
    //            `src/` were genuinely invalid**, and it was the only thing in the build that
    //            noticed. With it off, a browser silently DROPPED the invalid rules and rendered
    //            the rest — no error, no console message. Measured 2026-11-15: `.cm-table`,
    //            `.tp-comparison-table`, `.sig-loop-table`, `.uir-table`, `.rll-table`,
    //            `.pc-table` and `.tp-config-table` were all still rendered while their rules had
    //            been deleted by a botched text replacement (commit `ac63fa7f`, 2026-10-15) —
    //            tables lost `min-width`, `border-collapse`, sticky headers and cell padding.
    // INSTEAD OF: `cssMinify: false`, which silenced the messenger and shipped the broken CSS.
    // REVERSE BY: Nothing should. If the build fails here, the CSS is broken — fix the CSS.
    //             `node scripts/validate-css-parses.cjs` names the file, line and reason.
    // REGISTER:  docs/SETTLED-DECISIONS.md
    // GUARD:     scripts/validate-css-parses.cjs (prebuild; two checks, 11-case self-test)
    cssMinify: 'lightningcss',
  },
  server: {
    proxy: localProxy,
  },
  // `vite preview` (serving a BUILT edition locally) needs the same proxy — without it the
  // built app's /api calls hit CORS (the API only allows the dev-server origin) and the setup
  // guard redirects everything to /status/setup, making local verification useless.
  preview: {
    proxy: localProxy,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg', 'tcs-icon.PNG', 'tcs-logo.png'],
      manifest: {
        name: 'Trading Command Suite',
        short_name: 'TradeCS',
        description: 'Algorithmic trading analysis and portfolio management',
        theme_color: '#0f172a',
        background_color: '#0d1117',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'browser'],
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        categories: ['finance', 'productivity', 'utilities'],
        lang: 'en-US',
        dir: 'ltr',
        prefer_related_applications: false,
        icons: [
          {
            src: 'tcs-icon.PNG',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'tcs-icon.PNG',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'tcs-icon.PNG',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'tcs-icon.PNG',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB — see the note below; the 4 MB line was repeatedly exceeded
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/localhost:3201\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 // 1 hour
              }
            }
          },
          {
            urlPattern: /^https:\/\/query1\.finance\.yahoo\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'yahoo-finance-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5 // 5 min
              }
            }
          }
        ]
      }
    })
  ]
  };
});
