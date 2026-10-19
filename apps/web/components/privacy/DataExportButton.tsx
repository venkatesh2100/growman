"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { apiFetch, readApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import { buttonClass } from "../ui/buttonStyles";

/**
 * Downloads everything the shop holds about the signed-in customer.
 *
 * The endpoint authenticates with the Authorization header, which a plain
 * anchor cannot send, so the JSON is fetched and handed to the browser as a
 * blob instead of linked to directly.
 */
export default function DataExportButton() {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await apiFetch("/privacy/export");
      if (!res.ok) {
        toast(
          await readApiError(
            res,
            "We couldn't prepare your data just now. Please try again."
          ),
          "error"
        );
        return;
      }

      const objectUrl = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `growman-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      // Revoking in the same task as the click cancels the download in
      // Safari, so the URL is released once the browser has taken it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      toast(
        "We couldn't reach the server. Please check your connection and try again.",
        "error"
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={downloading}
        aria-busy={downloading}
        className={buttonClass("primary", "md", "mt-4")}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {downloading ? "Preparing your file" : "Download my data"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {downloading ? "Preparing your data file" : ""}
      </span>
    </>
  );
}
