// Login tokens for the shop. A token says who the user is, their role, and whether the profile is finished.
// Auth handlers sign tokens. The router attaches the middleware below to protected routes.
// A valid token is stored on req.user. A bad token sends a JSON error and does not call next.

import jwt from "jsonwebtoken";
import { error } from "../../pkg/httpjson/httpjson.js";

// A finished account. Checkout, orders, and profile edits require this scope.
export const ScopeFull = "full";
// A phone signup that still needs a name and profile. Only the onboarding routes accept this scope.
export const ScopeOnboarding = "onboarding";

// Admin screens call this. True for "admin" and "superadmin", ignoring case and surrounding spaces.
export function isAdminRole(role) {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "admin" || r === "superadmin";
}

// Login calls this after a successful sign-in. Returns a full-scope token.
export function generateToken(secret, userId, role, ttlMs) {
  return generateTokenWithScope(secret, userId, role, ScopeFull, ttlMs);
}

// Phone onboarding calls this with ScopeOnboarding. Other logins use generateToken.
// Returns a signed HS256 token. The lifetime is at least one second.
export function generateTokenWithScope(secret, userId, role, scope, ttlMs) {
  // An empty scope would lock the user out of both full and onboarding routes, so treat it as full.
  if (!scope) scope = ScopeFull;
  const ttl = Math.max(1, Math.floor(ttlMs / 1000));
  return jwt.sign({ userId: Number(userId), role, scope }, secret, { expiresIn: ttl, algorithm: "HS256" });
}

// Middleware calls this. Throws when the signature or the expiry is bad.
// A token with no scope is treated as a full account. userId is always a number.
export function parseToken(secret, tokenString) {
  const claims = jwt.verify(tokenString, secret, { algorithms: ["HS256"] });
  if (!claims.scope) claims.scope = ScopeFull;
  claims.userId = Number(claims.userId);
  return claims;
}

// Pulls the token out of "Authorization: Bearer <token>". Returns null when the header is missing or not two words.
function bearer(req) {
  const header = req.get("Authorization") || "";
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

// Sends the standard JSON error and stops the request. The middleware functions call this.
function writeAuthError(res, status, msg) {
  error(res, status, msg);
}

// Builds the middleware used by the three auth exports.
// required "" accepts any valid token. ScopeFull blocks onboarding tokens. ScopeOnboarding blocks full tokens.
// On success it sets req.user and calls next. On failure it sends 401 or 403 and does not call next.
function requireScope(secret, required) {
  return (req, res, next) => {
    const header = req.get("Authorization") || "";
    if (!header) {
      writeAuthError(res, 401, "missing Authorization header");
      return;
    }
    const token = bearer(req);
    if (!token) {
      writeAuthError(res, 401, "invalid Authorization header");
      return;
    }
    let claims;
    try {
      claims = parseToken(secret, token);
    } catch {
      // Bad signature, wrong algorithm, or an expired token. Do not say which.
      writeAuthError(res, 401, "invalid token");
      return;
    }
    // A half-finished signup cannot place an order or edit a full profile.
    if (required === ScopeFull && claims.scope === ScopeOnboarding) {
      writeAuthError(res, 403, "complete your profile first");
      return;
    }
    // The finish-profile route must not accept a token that is already a full account.
    if (required === ScopeOnboarding && claims.scope !== ScopeOnboarding) {
      writeAuthError(res, 403, "invalid token scope");
      return;
    }
    req.user = claims;
    next();
  };
}

// Any valid token, including onboarding. Routes that only need "someone logged in" use this.
// Returns Express middleware.
export function authMiddleware(secret) {
  return requireScope(secret, "");
}

// Checkout, orders, and account edits. An onboarding token is told to finish the profile.
// Returns Express middleware.
export function fullAuthMiddleware(secret) {
  return requireScope(secret, ScopeFull);
}

// Only the finish-profile routes. A full token is the wrong scope here.
// Returns Express middleware.
export function onboardingAuthMiddleware(secret) {
  return requireScope(secret, ScopeOnboarding);
}

// Catalog and other public pages. A good token sets req.user. A bad or missing token stays a guest.
// Returns Express middleware. Always calls next.
export function optionalAuthMiddleware(secret) {
  return (req, res, next) => {
    const token = bearer(req);
    if (token) {
      try {
        req.user = parseToken(secret, token);
      } catch {
        /* guest path stays valid */
      }
    }
    next();
  };
}

// Admin routes. Requires a full token and an admin or superadmin role.
// Returns Express middleware. Sends 403 when the role is not an admin.
export function adminMiddleware(secret) {
  const auth = fullAuthMiddleware(secret);
  return (req, res, next) => {
    auth(req, res, () => {
      if (!req.user || !isAdminRole(req.user.role)) {
        writeAuthError(res, 403, "admin access required");
        return;
      }
      next();
    });
  };
}

// Handlers call this when the route should already be authenticated.
// Returns the user claims, or null after sending 401.
export function requireUser(req, res) {
  if (!req.user) {
    writeAuthError(res, 401, "unauthorized");
    return null;
  }
  return req.user;
}
