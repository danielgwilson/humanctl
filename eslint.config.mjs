import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/ and lib/ are separate runtimes (Electron main + preload + static
// renderer, and plain CommonJS Node modules shared by the desktop app and the
// CLI), not part of the Next app, so they are not linted by the Next config.
// They are gated by `node --check`, the pulse selftest, the boot smoke, and
// scripts/secret-scan.sh instead.
const eslintConfig = [
  { ignores: ["electron/**", "lib/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
