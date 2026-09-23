import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Free-edition registry (GENERATED — scripts/generate-free-registry.cjs).
 * `vite build --mode free` swaps `src/core/view-routes.jsx` for this file, so premium page
 * code is PHYSICALLY ABSENT from the bundle — not hidden (the shipped JS is readable).
 * Source of truth: the `tier` field in src/core/view-meta.js. Plan: FREE-EDITION-PLAN.md §3/§4.
 */
const freeRegistryPath = fileURLToPath(
  new URL('./src/editions/view-routes.free.jsx', import.meta.url),
);

/** Free-edition variant of the direct-route page imports (App.jsx literal routes). */
const freeDirectPagesPath = fileURLToPath(
  new URL('./src/editions/direct-pages.free.jsx', import.meta.url),
);

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

export default defineConfig(({ mode }) => {
  const isFreeEdition = mode === 'free';
  return {
    // Compile-time edition flag — dead-code elimination can rely on it.
    define: {
      'import.meta.env.VITE_EDITION': JSON.stringify(isFreeEdition ? 'free' : 'full'),
    },
    resolve: isFreeEdition
      ? {
          alias: [
            // Only consumer today is App.jsx (`import { VIEW_COMPONENTS } from './core/view-routes.jsx'`).
            { find: './core/view-routes.jsx', replacement: freeRegistryPath },
            { find: 'src/core/view-routes.jsx', replacement: freeRegistryPath },
            // Direct-route pages (App.jsx literal routes) — nulls out premium pages.
            { find: './core/direct-pages.jsx', replacement: freeDirectPagesPath },
            { find: 'src/core/direct-pages.jsx', replacement: freeDirectPagesPath },
          ],
        }
      : {},
    css: {
      lightningcss: false,
    },
  build: {
    cssMinify: false, // lightningcss is too strict — disable CSS minification for now
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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MB — bundle exceeds default 2 MB
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
