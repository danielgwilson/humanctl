import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/, packages/ui/, lib/, bin/, scripts/perf-selftest/, and the
// plain-Node verification harnesses are
// separate runtimes (the Electron renderer + main + preload, the TS
// backend/CLI shared by the desktop app and the CLI, and the plain-Node
// perf, bundle-budget, screenshot-capture, and UI-foundation
// harnesses), not part of the Next app, so they are not linted by the Next
// config. They are gated by `tsc --noEmit` (npm run typecheck), the
// pulse/commands/reader/perf selftests, the boot smoke, and
// scripts/secret-scan.sh instead. Lazy require() calls in these files are
// deliberate (keeps every CLI command that does not need pulse/summary-budget
// free of that require cost), which the Next TypeScript config's
// no-require-imports rule would otherwise flag.
//
// electron/renderer-vite/ and packages/ui/ stay ignored here. Both browser
// trees are linted by electron/renderer-vite/eslint.config.mjs through
// `npm run lint:renderer`. Their dedicated TypeScript checks run through
// `npm run typecheck:renderer` and `npm run ui:check`. CI requires all three.
// Keeping the Next and renderer configs separate avoids applying Next runtime
// assumptions to a Vite/Electron application.
const eslintConfig = [
  {
    ignores: [
      "electron/**",
      "packages/ui/**",
      "lib/**",
      "bin/**",
      "scripts/perf-selftest/**",
      "scripts/bundle-size-check.js",
      "scripts/capture-screenshots.js",
      "scripts/design-lint-classnames.js",
      "scripts/package-hygiene-check.js",
      "scripts/ui-foundation-hygiene.mjs",
      "scripts/ui-foundation-ownership.mjs",
      "dist/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
