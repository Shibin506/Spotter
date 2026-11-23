import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode embed` builds a copy for an embedded preview: relative paths, no service worker.
export default defineConfig(({ mode }) => ({
  base: mode === 'embed' ? './' : '/',
  plugins: [
    react(),
    mode !== 'embed' && VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Spotter — real-time form coach',
        short_name: 'Spotter',
        description: 'Counts reps, checks depth and lockout, and calls out fixes while you lift. Runs on your device.',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Cache the app shell up front; the WASM runtime and pose models are cached the first time they load.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['mediapipe/**'],
        // Only the app itself falls back to index.html: the labelling page and the API must not
        // (any query string, e.g. ?utm=…, would otherwise send /label.html to the app).
        navigateFallbackDenylist: [/^\/label(\.html)?(\?|$)/, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/mediapipe/') || url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'spotter-models', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      // The labelling page ships with the app; the embed preview leaves it out (it needs downloads).
      input: (mode === 'embed' ? { main: 'index.html' } : { main: 'index.html', label: 'label.html' }) as Record<string, string>,
    },
  },
  server: { host: true },
}));
