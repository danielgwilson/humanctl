import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// MIGRATION SPIKE config (spike/electron-vite-shadcn). This does NOT replace
// the existing electron/main.js or electron/preload.js: the main/preload
// blocks below point electron-vite at those UNCHANGED files so it packages
// them as-is (no rewrite, no new IPC surface). Only the renderer block is new
// work: a React/Tailwind/shadcn app that consumes the EXISTING window.humanctl
// bridge. Output lands in electron/renderer-vite/dist-electron-vite/ so it
// never collides with the static electron/renderer/ the old renderer ships
// from; main.js loads one or the other behind the HUMANCTL_VITE env flag.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron-vite/main',
      rollupOptions: { input: resolve(__dirname, '../main.js') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron-vite/preload',
      rollupOptions: { input: resolve(__dirname, '../preload.js') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir: resolve(__dirname, 'dist-electron-vite/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
    server: {
      port: 5183, // distinctive port per spike verification requirements
      strictPort: true,
    },
  },
});
