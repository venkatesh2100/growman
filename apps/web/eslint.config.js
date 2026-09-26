import { globalIgnores } from "eslint/config";
import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  // Generated build output. The shared config already ignores `.next` and
  // `build`; these are this app's Cloudflare equivalents, and linting them
  // produced ~15,600 warnings that drowned out real source findings.
  globalIgnores([
    ".open-next/**",
    ".wrangler/**",
    "dist/**",
    "public/sw.js",
  ]),
];
