// Browser headers, slow-request logs, request deadlines, and an in-flight cap.
// The server mounts these on the whole app. Each export returns middleware, except securityHeaders which is the middleware.

// Sets the headers on every response, then calls next.
// HSTS is added only when the request itself is HTTPS, so a local HTTP dev server is not marked HTTPS-only.
export function securityHeaders(req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  // Modern browsers ignore this. Setting it to 0 turns the old auditor off.
  res.set("X-XSS-Protection", "0");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure || String(req.get("X-Forwarded-Proto") || "").toLowerCase() === "https") {
    res.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}

// Logs 500s and requests slower than slowMs. Health checks are skipped so probes do not fill the log.
// Returns middleware. The line is printed when the response finishes, not when it starts.
export function quietLogger(slowMs = 1200) {
  return (req, res, next) => {
    if (req.path === "/healthz" || req.path === "/api/v1/healthz") return next();
    const start = Date.now();
    res.on("finish", () => {
      const d = Date.now() - start;
      if (res.statusCode >= 500 || d >= slowMs) {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${d}ms`);
      }
    });
    next();
  };
}

// Sends 504 if the handler has not started the response within ms.
// Returns middleware. The timer is cleared when the response finishes or the client disconnects.
export function requestTimeout(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(504).json({ error: "request timeout" });
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

// Caps how many requests are being handled at once. Past max, the shop answers 503 instead of queueing forever.
// Returns middleware. The counter drops once, even if both finish and close fire.
export function throttle(max = 512) {
  let inflight = 0;
  return (req, res, next) => {
    if (inflight >= max) {
      res.status(503).json({ error: "server busy" });
      return;
    }
    inflight += 1;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      inflight -= 1;
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}
