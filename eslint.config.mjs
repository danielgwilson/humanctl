import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/, lib/, bin/, and scripts/perf-selftest/ are separate runtimes
// (Electron main + preload + static renderer, the TS backend/CLI shared by
// the desktop app and the CLI, and the plain-Node perf harness), not part of
// the Next app, so they are not linted by the Next config. They are gated by
// `tsc --noEmit` (npm run typecheck), the pulse/commands/reader/perf
// selftests, the boot smoke, and scripts/secret-scan.sh instead. Lazy
// require() calls in these files are deliberate (keeps every CLI command
// that does not need pulse/summary-budget free of that require cost), which
// the Next TypeScript config's no-require-imports rule would otherwise flag.
const eslintConfig = [
  { ignores: ["electron/**", "lib/**", "bin/**", "scripts/perf-selftest/**", "dist/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
