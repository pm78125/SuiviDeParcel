import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Optionnel — si Node/npm est installé : npm install && npm run dev */
export default defineConfig({
  root: '.',
  publicDir: 'icons',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'TreeTracker — Suivi de parcelle',
        short_name: 'TreeTracker',
        theme_color: '#0f3d2e',
        background_color: '#eef4ef',
        display: 'standalone',
        lang: 'fr',
        start_url: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
});
