"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { formatPrice } from "../../lib/format";
import { buttonClass } from "../ui/buttonStyles";

type Props = {
  orderId: number;
  amount: number;
  /** True when money has already been taken, so the copy can promise a refund. */
  refundable: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Confirmation step for cancelling an order. Presentational: the orders page
 * owns the request so it can update the row it already has.
 */
export default function CancelOrderDialog({
  orderId,
  amount,
  refundable,
  submitting,
  onConfirm,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const restoreTo = document.activeElement;
    keepRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreTo instanceof HTMLElement) restoreTo.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!submitting) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled])"
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-order-title"
        aria-describedby="cancel-order-description"
        className="w-full rounded-t-2xl bg-white px-5 py-5 sm:max-w-md sm:rounded-2xl"
      >
        <h2
          id="cancel-order-title"
          className="font-space text-lg font-semibold text-green-900"
        >
          Cancel order #{orderId}?
        </h2>
        <div
          id="cancel-order-description"
          className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600"
        >
          <p>
            We&apos;ll cancel this order and return the plants to stock. This
            cannot be undone, so you would need to place a new order.
          </p>
          {refundable ? (
            <p>
              A refund of {formatPrice(amount)} is then requested to the payment
              method you used. It takes a few working days to reach you.
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            ref={keepRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={buttonClass("secondary", "md", "sm:flex-1")}
          >
            Keep this order
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            aria-busy={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-400 sm:flex-1 sm:text-[15px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Cancelling
              </>
            ) : (
              "Cancel this order"
            )}
          </button>
        </div>

        <span role="status" aria-live="polite" className="sr-only">
          {submitting ? "Cancelling your order" : ""}
        </span>
      </div>
    </div>,
    document.body
  );
}
