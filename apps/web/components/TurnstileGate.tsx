"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useEffect, useState, useCallback } from "react";

const HV_COOKIE = "hv=1";

function readHasHumanVerifiedCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("hv=1");
}

function writeHumanVerifiedCookie() {
  document.cookie = `${HV_COOKIE}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

type TurnstileGateProps = {
  /** Fires when the user may proceed: no site key, or cookie already set, or Turnstile succeeded. */
  onHumanVerified: (verified: boolean) => void;
};

/**
 * Matches the prior app/turnstile.tsx pattern: fixed bottom-right, interaction-only,
 * skips rendering when the hv cookie is already present (browser session trust).
 */
export function TurnstileGate({ onHumanVerified }: TurnstileGateProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!siteKey) {
      onHumanVerified(true);
      return;
    }
    // if (readHasHumanVerifiedCookie()) {
    //   onHumanVerified(true);
    //   return;
    // }
    setShow(true);
  }, [siteKey, onHumanVerified]);

  const handleSuccess = useCallback(
    (_token: string) => {
      // writeHumanVerifiedCookie();
      setShow(false);
      onHumanVerified(true);
    },
    [onHumanVerified]
  );

  if (!siteKey || !show) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Turnstile
        siteKey={siteKey}
        options={{ appearance: "interaction-only" }}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

export function isTurnstileSiteConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
