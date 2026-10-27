// JSON response helpers. Error bodies are always {"error": "..."}.
// Route handlers call these instead of writing status and body by hand.
// json and error send a response and return nothing. decode returns the body or null.

// Handlers call this for every JSON success or error payload.
// Sends the status and the encoded body. A value that cannot be encoded becomes a 500.
export function json(res, status, payload) {
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    // Stop here. The client still gets a JSON error instead of a truncated body.
    res.status(500).type("application/json").send('{"error":"encode failed"}');
    return;
  }
  raw(res, status, body);
}

// Writes already-encoded JSON bytes with an exact length.
// Handlers and the json helper call this. Sends the response and returns nothing.
export function raw(res, status, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.status(status);
  res.set("Content-Type", "application/json; charset=utf-8");
  // Set the length ourselves so a proxy does not guess and cut the body short.
  res.set("Content-Length", String(buf.length));
  res.send(buf);
}

// Every error response goes through here so the shape stays {"error": "..."}.
// Sends the status and returns nothing.
export function error(res, status, msg) {
  json(res, status, { error: msg });
}

// Returns the parsed JSON object, or null after writing 400.
// badMsg defaults to "invalid request body".
// Handlers call this before they trust the body. An empty body, a non-object, or an array is rejected.
export function decode(req, res, badMsg = "invalid request body") {
  if (!req.rawBody || req.rawBody.length === 0 || req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
    error(res, 400, badMsg);
    return null;
  }
  return req.body;
}
