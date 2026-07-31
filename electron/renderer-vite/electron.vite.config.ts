import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as { version: string };

// This does NOT replace electron/main.ts or electron/preload.ts: the
// main/preload blocks below point electron-vite at the SAME compiled entry
// points tsup already produces (dist/electron/main.js,
// dist/electron/preload.js), so this config only packages them, it does not
// recompile them. The renderer block builds the thin React viewport that
// consumes the window.humanctl bridge through the runtime adapter.
// Renderer output lands in dist-electron-vite/renderer/, the path
// electron/main.ts's rendererTarget() always loads.
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
    define: {
      __HUMANCTL_VERSION__: JSON.stringify(version),
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src'), '@humanctl/ui': resolve(__dirname, '../../packages/ui/src') },
      dedupe: ['react', 'react-dom'],
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
      fs: {
        allow: [resolve(__dirname, '../..')],
      },
    },
  },
});
