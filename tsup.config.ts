import { defineConfig } from 'tsup';

// Build the CLI and its libraries to plain CommonJS JS under dist/, mirroring
// the source layout (dist/lib, dist/bin) so require()s between them keep
// working unmodified and package.json's `bin` can point at a stable compiled
// path.
export default defineConfig([
  {
    name: 'lib',
    entry: [
      'lib/sessions.ts',
      'lib/pulse.ts',
      'lib/commands.ts',
      'lib/span.ts',
      'lib/pricing.ts',
      'lib/summary-budget.ts',
      'lib/claude-quota.ts',
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
]);
