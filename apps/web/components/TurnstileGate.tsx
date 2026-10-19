"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useEffect, useState, useCallback } from "react";

type TurnstileGateProps = {
  /** Fires when the user may proceed: no site key, or Turnstile succeeded. */
  onHumanVerified: (verified: boolean) => void;
};

/**
 * Matches the prior app/turnstile.tsx pattern: fixed bottom-right, interaction-only.
 */
export function TurnstileGate({ onHumanVerified }: TurnstileGateProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!siteKey) {
      onHumanVerified(true);
      return;
    }
    setShow(true);
  }, [siteKey, onHumanVerified]);

  const handleSuccess = useCallback(
    () => {
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
