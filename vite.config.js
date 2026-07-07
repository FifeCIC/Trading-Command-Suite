import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  css: {
    lightningcss: false,
  },
  build: {
    cssMinify: false, // lightningcss is too strict — disable CSS minification for now
  },
  server: {
    proxy: {
      '/intranet': {
        target: 'http://localhost',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3201',
        changeOrigin: true,
      },
    },
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
});
