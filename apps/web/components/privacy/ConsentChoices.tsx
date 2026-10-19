"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  NOTICE_VERSION,
  readStoredConsent,
  recordConsent,
  storeConsent,
  type ConsentDecision,
  type StoredConsent,
} from "../../lib/consent";
import { toast } from "../../lib/toast";
import { buttonClass } from "../ui/buttonStyles";

const DECISION_LABEL: Record<ConsentDecision, string> = {
  accepted: "You agreed to analytics and personalisation.",
  declined: "You declined analytics and personalisation.",
};

/**
 * Lets a customer change the choice they made on the first-visit notice.
 *
 * Each change is recorded as a new consent entry rather than overwriting the
 * last one, so the history of what was agreed and when stays intact.
 */
export default function ConsentChoices() {
  const [stored, setStored] = useState<StoredConsent | null>(null);
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState<ConsentDecision | null>(null);

  useEffect(() => {
    setStored(readStoredConsent());
    setMounted(true);
  }, []);

  const change = async (decision: ConsentDecision) => {
    setSaving(decision);
    const noticeVersion = await recordConsent(decision);
    if (noticeVersion === null) {
      toast("We couldn't save that choice. Please try again.", "error");
      setSaving(null);
      return;
    }
    const next: StoredConsent = {
      decision,
      noticeVersion,
      decidedAt: new Date().toISOString(),
      recorded: true,
    };
    storeConsent(next);
    setStored(next);
    setSaving(null);
    toast(
      decision === "accepted"
        ? "Analytics and personalisation are on."
        : "Analytics and personalisation are off.",
      "success"
    );
  };

  const current = stored?.decision ?? null;

  return (
    <section
      aria-labelledby="consent-heading"
      className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
    >
      <h2 id="consent-heading" className="text-base font-semibold text-green-900">
        Analytics and personalisation
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        Cookies needed to run the shop — your cart and your sign-in — are always
        on. Measuring how the site is used and suggesting plants from what you
        have viewed are your choice, and you can change it at any time.
      </p>
      <p className="mt-2 text-sm text-gray-700" aria-live="polite">
        {!mounted
          ? "Checking your current choice…"
          : current
            ? DECISION_LABEL[current]
            : "You have not made a choice yet."}
      </p>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={() => void change("accepted")}
          disabled={saving !== null || current === "accepted"}
          aria-busy={saving === "accepted"}
          className={buttonClass("secondary", "md", "sm:min-w-36")}
        >
          {saving === "accepted" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Turn on
        </button>
        <button
          type="button"
          onClick={() => void change("declined")}
          disabled={saving !== null || current === "declined"}
          aria-busy={saving === "declined"}
          className={buttonClass("secondary", "md", "sm:min-w-36")}
        >
          {saving === "declined" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Turn off
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Privacy notice version {NOTICE_VERSION}. Every change is kept as a dated
        entry in your consent history, which is included in your data download.
      </p>
    </section>
  );
}
