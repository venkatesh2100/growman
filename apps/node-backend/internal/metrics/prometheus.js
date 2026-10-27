// Prometheus counters for request time, payment results, and stock races.
// The /metrics route calls metricsHandler. Checkout and webhooks call the record* functions.
// metricsHandler sends the scrape body. The record functions return nothing.

import client from "prom-client";

const register = new client.Registry();
// Process CPU, memory, and event-loop numbers, scraped alongside the shop metrics.
client.collectDefaultMetrics({ register });

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Same duration, stored under the name a server dashboard expects.
const httpServerRequests = new client.Histogram({
  name: "http_server_requests_seconds",
  help: "HTTP request duration in seconds for server requests.",
  labelNames: ["app", "uri", "method", "status"],
  buckets,
  registers: [register],
});

// Same duration again, under the name the other dashboard expects.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["path", "method", "service", "status"],
  buckets,
  registers: [register],
});

// Highest duration seen for each path since this process started. It only moves up.
const httpRequestDurationMax = new client.Gauge({
  name: "http_request_duration_seconds_max",
  help: "Maximum HTTP request duration in seconds per path.",
  labelNames: ["path", "method", "service", "status"],
  registers: [register],
});

// A Razorpay or webhook signature that did not match. stage says which check failed.
const paymentSignatureFailures = new client.Counter({
  name: "payment_signature_failures_total",
  help: "Rejected payment/webhook signature verifications, by stage.",
  labelNames: ["stage"],
  registers: [register],
});

// Paid, failed, and the other terminal payment results.
const paymentOutcomes = new client.Counter({
  name: "payment_outcomes_total",
  help: "Terminal payment outcomes, by result.",
  labelNames: ["result"],
  registers: [register],
});

// Checkout lost the race: the last plant was taken between the stock check and the reservation.
const inventoryConflicts = new client.Counter({
  name: "inventory_reservation_conflicts_total",
  help: "Checkout attempts rejected because stock ran out mid-flight.",
  registers: [register],
});

// Remembers the slowest request per path so the max gauge is not reset by a faster one.
const maxSeen = new Map();

// GET /metrics. Sends the Prometheus text, or 500 with the error string if the scrape fails.
export function metricsHandler(req, res) {
  register
    .metrics()
    .then((body) => {
      res.set("Content-Type", register.contentType);
      res.send(body);
    })
    .catch((err) => {
      res.status(500).send(String(err));
    });
}

// The request-timing middleware calls this when a response finishes. Returns nothing.
export function recordRequest(app, uri, method, status, durationSeconds) {
  const statusLabel = String(status);
  httpServerRequests.labels(app, uri, method, statusLabel).observe(durationSeconds);
  httpRequestDuration.labels(uri, method, app, statusLabel).observe(durationSeconds);
  const key = [uri, method, app, statusLabel].join("\0");
  const prev = maxSeen.get(key);
  // Only raise the gauge. A later fast request must not hide the slow one.
  if (prev == null || durationSeconds > prev) {
    maxSeen.set(key, durationSeconds);
    httpRequestDurationMax.labels(uri, method, app, statusLabel).set(durationSeconds);
  }
}

// Checkout and webhooks call this when a payment signature is rejected. Returns nothing.
export function recordPaymentSignatureFailure(stage) {
  paymentSignatureFailures.labels(stage).inc();
}

// Checkout calls this when a payment reaches a terminal result. Returns nothing.
export function recordPaymentOutcome(result) {
  paymentOutcomes.labels(result).inc();
}

// Checkout calls this when a stock reservation conflicts. Returns nothing.
export function recordInventoryConflict() {
  inventoryConflicts.inc();
}
