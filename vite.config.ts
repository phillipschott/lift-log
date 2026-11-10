/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site: https://<user>.github.io/lift-log/
const base = '/lift-log/';

// Vitest loads this config too; skip the app plugins there so the PWA
// plugin (service worker generation) never runs during tests.
const isTest = !!process.env.VITEST;

export default defineConfig({
  base,
  plugins: isTest
    ? []
    : [
        preact(),
        VitePWA({
          registerType: 'autoUpdate',
          injectRegister: 'auto',
          strategies: 'generateSW',
          // workbox.globPatterns below already precaches every public/ file.
          includeManifestIcons: false,
          manifest: {
            name: 'Lift Log',
            short_name: 'Lift Log',
            description: 'Offline lifting and food log.',
            display: 'standalone',
            orientation: 'portrait',
            background_color: '#0e0f11',
            theme_color: '#0e0f11',
            start_url: base,
            scope: base,
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            // Precache the whole build so the app runs in airplane mode after first load.
            globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,ico}'],
            navigateFallback: 'index.html',
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
          },
          devOptions: { enabled: false },
        }),
      ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
