import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// electron/ is a separate runtime (main + preload + static renderer), not part
// of the Next app, so it is not linted by the Next config. It is gated by
// `node --check`, the boot smoke, and scripts/secret-scan.sh instead.
const eslintConfig = [
  { ignores: ["electron/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
