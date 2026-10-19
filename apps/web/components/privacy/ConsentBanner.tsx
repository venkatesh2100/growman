"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CONSENT_DECIDED_EVENT,
  NOTICE_VERSION,
  needsConsentDecision,
  readStoredConsent,
  recordConsent,
  storeConsent,
  type ConsentDecision,
} from "../../lib/consent";
import { buttonClass } from "../ui/buttonStyles";

/**
 * First-visit notice about what the site collects.
 *
 * Accepting and declining are the same size and the same style on purpose:
 * declining is a real choice, and nothing on the site is withheld for making
 * it. The banner is fixed to the bottom and never locks scrolling or traps
 * focus, so the page stays usable while it is open.
 */
export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState<ConsentDecision | null>(null);

  useEffect(() => {
    const stored = readStoredConsent();
    if (needsConsentDecision(stored)) {
      setVisible(true);
      return;
    }
    if (stored && !stored.recorded) {
      void recordConsent(stored.decision).then((noticeVersion) => {
        if (noticeVersion) {
          storeConsent({ ...stored, noticeVersion, recorded: true });
        }
      });
    }
  }, []);

  const decide = async (decision: ConsentDecision) => {
    setSaving(decision);
    const noticeVersion = await recordConsent(decision);
    storeConsent({
      decision,
      noticeVersion: noticeVersion ?? NOTICE_VERSION,
      decidedAt: new Date().toISOString(),
      recorded: noticeVersion !== null,
    });
    setVisible(false);
    window.dispatchEvent(new Event(CONSENT_DECIDED_EVENT));
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4">
      <section
        aria-labelledby="consent-notice-title"
        className="mx-auto max-w-3xl rounded-2xl border border-emerald-100 bg-white/95 p-4 shadow-[0_12px_40px_rgba(6,78,59,0.14)] backdrop-blur-md sm:p-5"
      >
        <h2
          id="consent-notice-title"
          className="text-sm font-semibold text-green-900"
        >
          Cookies and your data
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
          We need a few cookies to keep your cart and sign-in working. With your
          agreement we also measure how the site is used and suggest plants
          based on what you have looked at. You can decline and shop as normal.
        </p>

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void decide("accepted")}
            disabled={saving !== null}
            aria-busy={saving === "accepted"}
            className={buttonClass("secondary", "md", "sm:min-w-32")}
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => void decide("declined")}
            disabled={saving !== null}
            aria-busy={saving === "declined"}
            className={buttonClass("secondary", "md", "sm:min-w-32")}
          >
            Decline
          </button>
          <Link
            href="/privacy-policy"
            className="text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 sm:ml-2"
          >
            Read our privacy policy
          </Link>
        </div>
      </section>
    </div>
  );
}
