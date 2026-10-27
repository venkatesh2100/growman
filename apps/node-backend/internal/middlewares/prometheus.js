// Times each HTTP request and records it for the /metrics scrape.
// The server mounts the middleware this file exports. It does not send a body.
// Health and metrics paths are skipped so scrapes and probes do not count as shop traffic.

import { recordRequest } from "../metrics/prometheus.js";

// Returns middleware. appName is the label that tells this process apart in the dashboard.
export function prometheus(appName) {
  return (req, res, next) => {
    const path = req.path;
    // A scrape of /metrics must not record itself, and health checks are not shopper traffic.
    if (path === "/metrics" || path === "/healthz" || path === "/api/v1/healthz") return next();
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // Prefer the route pattern (/orders/:id) so each order id does not become its own metric.
      // If Express has not matched a route, the raw path is all we have.
      const uri = req.route ? `${req.baseUrl || ""}${req.route.path}` : path;
      const status = res.statusCode || 200;
      recordRequest(appName, uri, req.method, status, seconds);
    });
    next();
  };
}
