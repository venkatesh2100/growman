export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.venky2100.growman&pcampaignid=web_share";

export const PLAY_STORE_PACKAGE = "com.venky2100.growman";

/** Opens Play Store on Android, falls back to web URL elsewhere. */
export function openPlayStore(): void {
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = `market://details?id=${PLAY_STORE_PACKAGE}`;
    return;
  }
  window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
}
