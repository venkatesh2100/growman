// Serves the API reference: the OpenAPI file, the docs page, and the Redoc page.
// The server calls mountDocs once while building the router.
// Each route sends a file, or redirects the old Swagger paths to /docs.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Files live next to this module: openapi.yaml, index.html, redoc.html.
const dir = dirname(fileURLToPath(import.meta.url));

// Reads one docs file from disk and sends it. A missing file becomes a short 500, not a stack trace.
function sendFile(res, name, type) {
  try {
    const data = readFileSync(join(dir, name));
    res.set("Content-Type", type);
    // Browsers should recheck so a spec edit shows up without a hard refresh fight.
    res.set("Cache-Control", "no-cache");
    res.status(200).send(data);
  } catch {
    res.status(500).type("text/plain").send(name.endsWith(".yaml") ? "openapi spec not found" : "docs page not found");
  }
}

// Wires the public doc URLs. Called by the server at startup. Returns nothing.
export function mountDocs(app) {
  const spec = (req, res) => sendFile(res, "openapi.yaml", "application/yaml; charset=utf-8");
  const ui = (req, res) => sendFile(res, "index.html", "text/html; charset=utf-8");
  const redoc = (req, res) => sendFile(res, "redoc.html", "text/html; charset=utf-8");
  // Old bookmarks used /swagger. Send them to the page we actually host.
  const redirect = (req, res) => res.redirect(302, "/docs");
  app.get("/openapi.yaml", spec);
  app.get("/docs/openapi.yaml", spec);
  app.get(["/docs", "/docs/"], ui);
  app.get(["/redoc", "/redoc/"], redoc);
  app.get(["/swagger", "/swagger/", "/swagger-ui", "/swagger-ui/"], redirect);
}
