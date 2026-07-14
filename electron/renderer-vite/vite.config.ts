import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as { version: string };

// Plain Vite config for BROWSER verification only (no Electron launch): the
// fast loop for UI work against fixture data, per AGENTS.md's "prefer the
// browser for UI work" (root `npm run renderer` runs this). The real
// electron-vite pipeline (main + preload + renderer, driving an actual
// Electron window) is electron.vite.config.ts, run via `npm run dev:electron`
// / `npm run build`.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [react(), tailwindcss()],
  define: {
    __HUMANCTL_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5183,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
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
