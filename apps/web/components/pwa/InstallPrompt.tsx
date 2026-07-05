"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X, Smartphone } from "lucide-react";
import { openPlayStore, PLAY_STORE_URL } from "../../lib/appLinks";

const DISMISS_KEY = "growman-app-install-dismissed";

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const standalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true || window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIsMobile(mobile);

    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) {
      const daysSince = (Date.now() - Number(dismissed)) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }

    if (!standalone) {
      const timer = window.setTimeout(() => setVisible(true), 2500);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleInstall = () => {
    openPlayStore();
    handleDismiss();
  };

  if (!visible || isStandalone) return null;

  return (
    <div
      className={`fixed z-50 ${
        isMobile
          ? "bottom-0 left-0 right-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "bottom-6 right-6 max-w-sm"
      }`}
    >
      <div className="relative rounded-xl border border-emerald-100 bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.18)]">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-2 top-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Dismiss app install prompt"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
            <Smartphone className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">
              Get the Growman app
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-gray-600">
              Shop plants faster on mobile with our Android app on Google Play.
            </p>
            <button
              type="button"
              onClick={handleInstall}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 active:bg-emerald-800 sm:w-auto"
            >
              <Image
                src="/icons/growman.svg"
                alt=""
                width={18}
                height={18}
                className="brightness-0 invert"
              />
              Install on Google Play
            </button>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-center text-[11px] text-emerald-700 underline sm:text-left"
            >
              View on Play Store
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
