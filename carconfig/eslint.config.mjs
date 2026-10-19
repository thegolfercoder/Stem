import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/*
 * eslint-config-next ships flat configs directly on Next 16, so this needs no
 * FlatCompat shim — passing these through one breaks on a circular reference
 * in the react plugin.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
