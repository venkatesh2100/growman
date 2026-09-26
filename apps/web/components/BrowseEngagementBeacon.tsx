"use client";

import { useEffect } from "react";
import { getApiUrl, resolveAuthToken } from "../lib/api";

const ALERT_AFTER_MS = 10 * 60 * 1000;
const STORAGE_KEY = "growman_browse_alerted";
const SESSION_KEY = "growman_browse_session";
const PATHS_KEY = "growman_browse_paths";

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function trackPath(path: string) {
  try {
    const raw = sessionStorage.getItem(PATHS_KEY);
    const paths: string[] = raw ? JSON.parse(raw) : [];
    if (paths[paths.length - 1] !== path) {
      paths.push(path);
      sessionStorage.setItem(PATHS_KEY, JSON.stringify(paths.slice(-40)));
    }
  } catch {
    // ignore
  }
}

function alreadyAlerted(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markAlerted() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Silently reports to the backend after 10 minutes of browsing.
 * No UI — fire-and-forget.
 */
export default function BrowseEngagementBeacon() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (alreadyAlerted()) return;

    trackPath(window.location.pathname);
    const onPath = () => trackPath(window.location.pathname);
    window.addEventListener("popstate", onPath);

    const started = Date.now();
    const timer = window.setTimeout(async () => {
      if (alreadyAlerted()) return;
      markAlerted();

      let paths: string[] = [];
      try {
        paths = JSON.parse(sessionStorage.getItem(PATHS_KEY) || "[]");
      } catch {
        paths = [window.location.pathname];
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      const token = resolveAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      try {
        await fetch(`${getApiUrl()}/engagement/long-browse`, {
          method: "POST",
          headers,
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            sessionId: sessionId(),
            durationMin: Math.max(10, Math.round((Date.now() - started) / 60000)),
            path: window.location.pathname,
            paths,
            referrer: document.referrer || "",
          }),
        });
      } catch {
        // silent
      }
    }, ALERT_AFTER_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPath);
    };
  }, []);

  return null;
}
