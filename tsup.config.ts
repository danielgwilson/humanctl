import { defineConfig } from 'tsup';

// Build the backend/CLI/electron-main surface to plain CommonJS JS under
// dist/, mirroring the source layout (dist/lib, dist/bin, dist/electron) so
// require()s between them keep working unmodified and package.json's `bin`
// / `main` can point at stable compiled paths. The renderer
// (electron/renderer-vite/**) has its own Vite/electron-vite build (see
// `build:renderer-vite` in package.json) and is not part of this config.
export default defineConfig([
  {
    name: 'lib',
    entry: [
      'lib/sessions.ts',
      'lib/pulse.ts',
      'lib/commands.ts',
      'lib/span.ts',
      'lib/pricing.ts',
      'lib/harness-icons.ts',
      'lib/summary-budget.ts',
    ],
    outDir: 'dist/lib',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    shims: false,
    skipNodeModulesBundle: true,
  },
  {
    name: 'bin',
    entry: { humanctl: 'bin/humanctl.ts' },
    outDir: 'dist/bin',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    dts: false,
    shims: false,
    skipNodeModulesBundle: true,
    // lib/ is required at a relative path (../lib/commands etc.) from the
    // compiled bin/humanctl.js, which resolves to dist/lib/*.js: keep that
    // import external (not bundled) so both outputs share one compiled copy
    // of lib/ instead of duplicating it into the CLI bundle.
    external: [/^\.\.\/lib\//],
  },
  {
    name: 'electron-main',
    // reader-service is the utilityProcess entry (electron/reader-service.ts,
    // see AGENTS.md "Never block the Electron main process"): a separate
    // Node process main.ts forks via utilityProcess.fork(path.join(__dirname,
    // 'reader-service.js'), ...), so it must compile to
    // dist/electron/reader-service.js alongside main.js/preload.js, with the
    // SAME external config (../lib/ and 'electron' stay require()'d at
    // runtime, never bundled) so it resolves lib/sessions from inside the
    // asar exactly like main.js already does.
    entry: { main: 'electron/main.ts', preload: 'electron/preload.ts', 'reader-service': 'electron/reader-service.ts' },
    outDir: 'dist/electron',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    dts: false,
    shims: false,
    skipNodeModulesBundle: true,
    external: [/^\.\.\/lib\//, 'electron'],
  },
]);
