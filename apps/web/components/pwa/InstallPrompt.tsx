"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running on iOS
    const iOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    setIsIOS(iOS);

    // Check if already installed (standalone mode)
    const standalone =
      (window.navigator as any).standalone ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    // Listen for beforeinstallprompt event (Android/Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show prompt after a delay (user has interacted with the site)
      setTimeout(() => {
        if (!standalone) {
          setShowPrompt(true);
        }
      }, 3000);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Check if user has dismissed the prompt before (localStorage)
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed =
        (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      // Show again after 7 days
      if (daysSinceDismissed < 7) {
        setShowPrompt(false);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === "accepted") {
        setShowPrompt(false);
        setDeferredPrompt(null);
      }
    }
    handleDismiss();
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  // Don't show if already installed or on desktop
  if (isStandalone || !showPrompt) {
    return null;
  }

  // iOS instructions
  if (isIOS) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
        <div className="bg-white border-t border-gray-200 shadow-lg p-4 mx-4 mb-4 rounded-lg">
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <Download className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">
                Install Growman App
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Tap the share button and select "Add to Home Screen"
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Android/Chrome prompt
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
        <div className="bg-white border-t border-gray-200 shadow-lg p-4 mx-4 mb-4 rounded-lg">
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 touch-manipulation"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <Download className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">
                Install Growman App
              </h3>
              <p className="text-xs text-gray-600 mb-3">
                Get a faster, app-like experience on your device
              </p>
              <button
                onClick={handleInstallClick}
                className="w-full bg-emerald-600 text-white py-2 px-4 rounded-lg font-medium text-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors touch-manipulation"
              >
                Install Now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
