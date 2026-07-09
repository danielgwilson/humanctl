import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/, lib/, bin/, scripts/perf-selftest/, scripts/bundle-size-check.js,
// scripts/capture-screenshots.js, and scripts/design-lint-classnames.js are
// separate runtimes (the Electron renderer + main + preload, the TS
// backend/CLI shared by the desktop app and the CLI, and the plain-Node
// perf, bundle-budget, screenshot-capture, and retired-classname-grep
// harnesses), not part of the Next app, so they are not linted by the Next
// config. They are gated by `tsc --noEmit` (npm run typecheck), the
// pulse/commands/reader/perf selftests, the boot smoke, and
// scripts/secret-scan.sh instead. Lazy require() calls in these files are
// deliberate (keeps every CLI command that does not need pulse/summary-budget
// free of that require cost), which the Next TypeScript config's
// no-require-imports rule would otherwise flag.
//
// electron/renderer-vite/ is the one exception worth naming: it stays ignored
// here, but it is no longer unlinted. It now has its OWN flat config
// (electron/renderer-vite/eslint.config.mjs: typescript-eslint + react-hooks +
// react-refresh) plus its own `tsc --noEmit`, both invoked from the repo root by
// `npm run lint:renderer` / `npm run typecheck:renderer` and both required in
// CI. Keeping the two configs disjoint is deliberate: the Next config's
// browser/Next assumptions do not apply to a Vite/Electron renderer, and a
// single merged config would have to special-case one of them anyway.
const eslintConfig = [
  {
    ignores: [
      "electron/**",
      "lib/**",
      "bin/**",
      "scripts/perf-selftest/**",
      "scripts/bundle-size-check.js",
      "scripts/capture-screenshots.js",
      "scripts/design-lint-classnames.js",
      "dist/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
