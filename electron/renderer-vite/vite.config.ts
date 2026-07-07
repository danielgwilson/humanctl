import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Plain Vite config for BROWSER verification only (no Electron launch): the
// fast loop for UI work against fixture data, per AGENTS.md's "prefer the
// browser for UI work" (root `npm run renderer` runs this). The real
// electron-vite pipeline (main + preload + renderer, driving an actual
// Electron window) is electron.vite.config.ts, run via `npm run dev:electron`
// / `npm run build`.
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
  preview: {
    port: 4188,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
