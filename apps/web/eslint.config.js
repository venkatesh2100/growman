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
  {
    // The root error boundary replaces the whole document and runs when the
    // app shell itself has failed, so its escape links must be plain
    // anchors: next/link routes through the client router, which is one of
    // the things that may be broken. A hard navigation is the intent here,
    // not an oversight.
    files: ["app/global-error.tsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];
