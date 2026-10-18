import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// lib/, bin/, and the plain-Node package check are the CLI runtime, not part
// of the Next app, so they are not linted by the Next config. They are gated
// by `tsc --noEmit` (npm run typecheck), the selftests, and
// scripts/secret-scan.sh instead. Lazy require() calls in these files are
// deliberate (keeps every CLI command that does not need pulse/summary-budget
// free of that require cost), which the Next TypeScript config's
// no-require-imports rule would otherwise flag.
const eslintConfig = [
  {
    ignores: [
      "lib/**",
      "bin/**",
      "scripts/package-hygiene-check.js",
      "dist/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
