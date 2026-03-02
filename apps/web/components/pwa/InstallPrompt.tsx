"use client";

import { useEffect, useState, useRef } from "react";
import { X, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

type BrowserType = "chrome" | "firefox" | "safari" | "brave" | "ios" | "other";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [browser, setBrowser] = useState<BrowserType>("other");
  const [isMobile, setIsMobile] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Detect browser
    const userAgent = navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;
    setIsIOS(isIOSDevice);
    setIsMobile(/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent));

    // Detect browser type
    let detectedBrowser: BrowserType = "other";
    if (isIOSDevice) {
      detectedBrowser = "ios";
    } else if (userAgent.includes("firefox")) {
      detectedBrowser = "firefox";
    } else if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      detectedBrowser = "safari";
    } else if (userAgent.includes("brave")) {
      detectedBrowser = "brave";
    } else if (userAgent.includes("chrome") || userAgent.includes("edg")) {
      detectedBrowser = "chrome";
    }
    setBrowser(detectedBrowser);

    // Check if already installed (standalone mode)
    const nav = navigator as NavigatorStandalone;
    const standalone =
      nav.standalone ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    // Check if user has dismissed the prompt before (localStorage)
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    let shouldShow = true;
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed =
        (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      // Show again after 7 days
      if (daysSinceDismissed < 7) {
        shouldShow = false;
      }
    }

    // Listen for beforeinstallprompt event (Chrome/Edge/Brave on Android)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      deferredPromptRef.current = promptEvent;
      // Show prompt after a delay (user has interacted with the site)
      if (shouldShow && !standalone) {
        setTimeout(() => {
          setShowPrompt(true);
        }, 3000);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // For browsers that don't support beforeinstallprompt, show prompt anyway
    // (Firefox, Safari, iOS Safari)
    const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent);
    if (shouldShow && !standalone && !deferredPromptRef.current) {
      // Only show for mobile devices or Safari desktop
      if (isMobileDevice || detectedBrowser === "safari" || detectedBrowser === "firefox" || detectedBrowser === "ios") {
        setTimeout(() => {
          // Double-check we still don't have deferredPrompt (in case it fired late)
          if (!deferredPromptRef.current) {
            setShowPrompt(true);
          }
        }, 3000);
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

  // Don't show if already installed
  if (isStandalone || !showPrompt) {
    return null;
  }

  // iOS Safari instructions
  if (isIOS || browser === "ios") {
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
              <p className="text-xs text-gray-600 mb-2">
                Tap the <span className="font-semibold">Share</span> button{" "}
                <span className="inline-block">(□↗)</span> at the bottom, then select{" "}
                <span className="font-semibold">&ldquo;Add to Home Screen&rdquo;</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Firefox instructions
  if (browser === "firefox") {
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
              <p className="text-xs text-gray-600 mb-2">
                {isMobile ? (
                  <>
                    Tap the <span className="font-semibold">menu</span> button (☰) and select{" "}
                    <span className="font-semibold">&ldquo;Install&rdquo;</span> or{" "}
                    <span className="font-semibold">&ldquo;Add to Home Screen&rdquo;</span>
                  </>
                ) : (
                  <>
                    Click the <span className="font-semibold">menu</span> button (☰) and select{" "}
                    <span className="font-semibold">&ldquo;Install&rdquo;</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Safari desktop instructions
  if (browser === "safari" && !isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="bg-white border-t border-gray-200 shadow-lg p-4 mb-4 rounded-lg max-w-md mx-auto">
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
                Go to <span className="font-semibold">File</span> →{" "}
                <span className="font-semibold">&ldquo;Add to Dock&rdquo;</span> or use the Share button in the address bar
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Brave browser (similar to Chrome but may not have beforeinstallprompt)
  if (browser === "brave" && !deferredPrompt) {
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
              <p className="text-xs text-gray-600 mb-2">
                Tap the <span className="font-semibold">menu</span> button (☰) and look for{" "}
                <span className="font-semibold">&ldquo;Install&rdquo;</span> or{" "}
                <span className="font-semibold">&ldquo;Add to Home Screen&rdquo;</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Chrome/Edge/Android with beforeinstallprompt (native install button)
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

  // Generic fallback for other browsers
  if (isMobile) {
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
              <p className="text-xs text-gray-600 mb-2">
                Look for an <span className="font-semibold">&ldquo;Install&rdquo;</span> or{" "}
                <span className="font-semibold">&ldquo;Add to Home Screen&rdquo;</span> option in your browser menu
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

