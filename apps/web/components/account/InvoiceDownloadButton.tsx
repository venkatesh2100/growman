"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { apiFetch, readApiError } from "../../lib/api";
import { toast } from "../../lib/toast";

type Props = {
  orderId: number;
  invoiceNumber: string;
};

/**
 * Downloads an order's tax invoice.
 *
 * The endpoint authenticates with the Authorization header, which a plain
 * anchor cannot send, so the PDF is fetched and handed to the browser as a
 * blob instead of linked to directly.
 */
export default function InvoiceDownloadButton({ orderId, invoiceNumber }: Props) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await apiFetch(`/orders/${orderId}/invoice`, {
        headers: { Accept: "application/pdf" },
      });
      if (!res.ok) {
        toast(
          await readApiError(
            res,
            "We could not prepare that invoice. Please try again."
          ),
          "error"
        );
        return;
      }

      const objectUrl = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `invoice-${invoiceNumber.replace(/[^A-Za-z0-9.-]+/g, "-")}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      // Revoking in the same task as the click cancels the download in
      // Safari, so the URL is released once the browser has taken it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      toast(
        "We could not fetch that invoice. Please check your connection and try again.",
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
        aria-label={
          downloading
            ? `Preparing invoice for order #${orderId}`
            : `Download invoice for order #${orderId}`
        }
        className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-900 disabled:text-gray-400"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {downloading ? "Preparing invoice" : "Download invoice"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {downloading ? "Preparing your invoice" : ""}
      </span>
    </>
  );
}
