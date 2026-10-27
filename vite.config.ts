/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Basis-Pfad: Der GitHub-Actions-Workflow setzt BASE_PATH auf den Pages-Unterordner (z. B. "/neon-fleet/"),
// damit Service-Worker-Scope, Manifest und Icons absolut unter dem Pages-Link liegen.
// Ohne BASE_PATH (lokal, Netlify, Cloudflare) bleibt es bei relativen Pfaden.
const rawBase = process.env.BASE_PATH?.trim();
const base = rawBase ? `/${rawBase.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/') : './';

export default defineConfig({
  base,
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'NEON FLEET',
        short_name: 'NEON FLEET',
        description: 'Cyberpunk-Schiffe-versenken – Online-Multiplayer & KI',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'portrait',
        background_color: '#07020f',
        theme_color: '#07020f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
