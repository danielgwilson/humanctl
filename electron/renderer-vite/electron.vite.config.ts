import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// STAGE 1b config. This does NOT replace electron/main.ts or
// electron/preload.ts: the main/preload blocks below point electron-vite at
// the SAME compiled entry points tsup already produces (dist/electron/main.js,
// dist/electron/preload.js), so this config only packages them, it does not
// recompile them. Only the renderer block is new work: a React/Tailwind/
// shadcn app that consumes the EXISTING window.humanctl bridge over the
// unchanged preload. Renderer output lands in
// dist-electron-vite/renderer/ so it never collides with the static
// electron/renderer/ the old renderer ships from; electron/main.ts loads one
// or the other behind the HUMANCTL_VITE env flag (see rendererTarget() in
// electron/main.ts).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron-vite/main',
      rollupOptions: { input: resolve(__dirname, '../../dist/electron/main.js') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron-vite/preload',
      rollupOptions: { input: resolve(__dirname, '../../dist/electron/preload.js') },
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
      minify: 'esbuild',
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
    server: {
      port: 5183,
      strictPort: true,
    },
  },
});
