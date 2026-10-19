/**
 * Consent capture for the first-visit privacy notice (`POST /consent`).
 *
 * Every choice is a new row server-side, including a withdrawal, so consent
 * history stays an audit trail. Nothing here mutates a previous decision.
 */

import { apiFetch, readJson } from "./api";

/**
 * The notice the banner describes. Versions are date-ordered strings and are
 * compared as such, so a server already serving a newer notice does not make
 * the banner re-ask until this constant catches up.
 */
export const NOTICE_VERSION = "2026-01";

/**
 * The purposes the server accepts. "essential" covers what running the shop
 * needs — taking an order and delivering it — and is not withdrawn from the
 * banner, because an order already placed still has to arrive.
 */
export type ConsentPurpose =
  | "essential"
  | "analytics"
  | "marketing"
  | "personalisation";

export type ConsentDecision = "accepted" | "declined";

export interface StoredConsent {
  decision: ConsentDecision;
  noticeVersion: string;
  decidedAt: string;
  /** False when the request failed; the banner retries it on the next visit. */
  recorded: boolean;
}

const STORAGE_KEY = "growman-consent";

/** Lets the install prompt wait its turn instead of stacking under the banner. */
export const CONSENT_DECIDED_EVENT = "growman:consent-decided";

export function readStoredConsent(): StoredConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (parsed.decision !== "accepted" && parsed.decision !== "declined") {
      return null;
    }
    return {
      decision: parsed.decision,
      noticeVersion: String(parsed.noticeVersion ?? ""),
      decidedAt: String(parsed.decidedAt ?? ""),
      recorded: parsed.recorded !== false,
    };
  } catch {
    return null;
  }
}

export function storeConsent(value: StoredConsent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A visitor with storage blocked is asked again next time, which is the
    // safe direction to fail in.
  }
}

/** True when no decision covers the current notice yet. */
export function needsConsentDecision(
  stored: StoredConsent | null = readStoredConsent()
): boolean {
  return stored === null || stored.noticeVersion < NOTICE_VERSION;
}

export function purposesFor(
  decision: ConsentDecision
): Record<ConsentPurpose, boolean> {
  const optional = decision === "accepted";
  return {
    essential: true,
    analytics: optional,
    marketing: optional,
    personalisation: optional,
  };
}

interface RecordConsentResponse {
  success?: boolean;
  noticeVersion?: string;
}

/**
 * Records the choice and returns the notice version the server filed it
 * against, or null if the request did not get through.
 */
export async function recordConsent(
  decision: ConsentDecision
): Promise<string | null> {
  try {
    const res = await apiFetch("/consent", {
      method: "POST",
      body: JSON.stringify({ purposes: purposesFor(decision) }),
    });
    if (!res.ok) return null;
    const body = await readJson<RecordConsentResponse>(res);
    return body.noticeVersion || NOTICE_VERSION;
  } catch {
    return null;
  }
}
