import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
  server: { host: true },
});
