import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/**
 * Lets the built-in Node test runner load the app's TypeScript modules.
 *
 * Node strips types natively (`--experimental-strip-types`) but its ESM
 * resolver requires explicit file extensions, whereas the application source
 * uses bundler-style extensionless imports such as `./site`. This hook fills
 * that gap by appending `.ts`/`.tsx` (or resolving a directory `index` file)
 * when a relative specifier has no extension.
 *
 * Keeping this here avoids adding a test-runner dependency, which the
 * workspace's per-app pnpm hoisting settings make awkward to install.
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js"];

function tryResolve(basePath) {
  for (const extension of EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = resolvePath(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);

    if (isRelative && !hasExtension && context.parentURL) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const resolved = tryResolve(resolvePath(parentDir, specifier));
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
