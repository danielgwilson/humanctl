import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/, lib/, and scripts/perf-selftest/ are separate runtimes (Electron
// main + preload + static renderer, plain CommonJS Node modules shared by the
// desktop app and the CLI, and the plain-Node perf harness), not part of the
// Next app, so they are not linted by the Next config. They are gated by
// `node --check`, the pulse/commands/perf selftests, the boot smoke, and
// scripts/secret-scan.sh instead.
const eslintConfig = [
  { ignores: ["electron/**", "lib/**", "scripts/perf-selftest/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
