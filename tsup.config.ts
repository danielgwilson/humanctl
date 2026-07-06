import { defineConfig } from 'tsup';

// Build the backend/CLI/electron-main surface to plain CommonJS JS under
// dist/, mirroring the source layout (dist/lib, dist/bin, dist/electron) so
// require()s between them keep working unmodified and package.json's `bin`
// / `main` can point at stable compiled paths. The renderer
// (electron/renderer/**) is plain static JS with no build step and is not
// part of this config; it ships as-is (see package.json "files").
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
    entry: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
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
