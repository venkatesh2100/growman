// Client IP helpers for rate limits and visitor alerts.
// Rate limits call clientIP. Visitor alerts call exactIP and isPublicIP.
// Private, loopback, and spoofed leftmost addresses are not treated as the shopper.

import { isIP } from "node:net";

// The address we count for rate limits. Cloudflare and True-Client headers win because the socket is the proxy.
// Returns a string, possibly empty.
export function clientIP(req) {
  if (!req) return "";
  const cf = (req.get("CF-Connecting-IP") || "").trim();
  if (cf) return stripPort(cf);
  const tc = (req.get("True-Client-IP") || "").trim();
  if (tc) return stripPort(tc);
  const remote = req.socket?.remoteAddress || req.ip || "";
  return stripPort(remote) || remote;
}

// The public address for a visitor alert. Walks X-Forwarded-For from the right, which is the hop the proxy appended.
// The leftmost value can be forged by the client, so it is ignored. Returns "" when nothing public is found.
export function exactIP(req) {
  if (!req) return "";
  const fromXff = lastPublicIP(req.get("X-Forwarded-For") || "");
  if (fromXff) return fromXff;
  return publicIPString(req.socket?.remoteAddress || "");
}

// True when the string is a real public IP. Used before a location lookup so we do not query private addresses.
export function isPublicIP(raw) {
  return Boolean(publicIPString(raw));
}

// Rightmost public address in an X-Forwarded-For list. Returns "" if every hop is private or junk.
function lastPublicIP(xff) {
  const parts = xff.split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = publicIPString(parts[i]);
    if (ip) return ip;
  }
  return "";
}

// Parsed public address, or "" for private, loopback, and garbage.
function publicIPString(raw) {
  const ip = parseIP(raw);
  if (!ip || !isPublic(ip)) return "";
  return ip;
}

// Strips quotes, brackets, and a trailing :port on an IPv4 host. Returns "" when the result is not an IP.
function parseIP(raw) {
  let s = String(raw ?? "").trim().replace(/^["[]+|["\]]+$/g, "");
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end > 0) s = s.slice(1, end);
  } else if (s.includes(".") && s.includes(":")) {
    // IPv4 with a port, such as 1.2.3.4:443. IPv6 also has colons, so this only runs when a dot is present.
    s = s.replace(/:\d+$/, "");
  }
  if (isIP(s) === 0) return "";
  return s;
}

// Parsed IP when possible. If parsing fails, the original string is kept so rate-limit keys still have a value.
function stripPort(ip) {
  const parsed = parseIP(ip);
  return parsed || String(ip ?? "");
}

// False for loopback, private, link-local, multicast, documentation, and carrier-grade NAT ranges.
function isPublic(ip) {
  if (!ip) return false;
  if (ip === "::1" || ip === "0.0.0.0" || ip === "::") return false;
  const v4 = ipv4(ip);
  if (v4) {
    const [a, b, c] = v4;
    // 10/8, loopback, and 0/8 are not shoppers.
    if (a === 10 || a === 127 || a === 0) return false;
    // 172.16.0.0/12.
    if (a === 172 && b >= 16 && b <= 31) return false;
    // 192.168.0.0/16 and link-local 169.254.0.0/16.
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    // Multicast and reserved space from 224 upward.
    if (a >= 224) return false;
    // TEST-NET documentation ranges, not real customers.
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    // 100.64.0.0/10, carrier-grade NAT.
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  // IPv6 unique-local (fc/fd), link-local (fe80), and multicast (ff).
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("ff")) return false;
  return true;
}

// Four numeric octets, including an IPv4 address hidden inside ::ffff:. Returns null for anything else.
function ipv4(ip) {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}
