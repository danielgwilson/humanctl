import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Plain Vite config for BROWSER verification only (no Electron launch): this
// is how the spike is checked visually in a normal browser tab against
// fixture data, mirroring AGENTS.md's "prefer the browser for UI work" loop
// for the existing static renderer (`npm run renderer`). The real
// electron-vite pipeline (main + preload + renderer, driving an actual
// Electron window) is electron.vite.config.ts, run via `npm run dev` /
// `npm run build`.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5183,
    strictPort: true,
  },
});
