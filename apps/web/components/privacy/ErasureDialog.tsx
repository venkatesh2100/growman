"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, readJson, type ApiError } from "../../lib/api";
import { buttonClass } from "../ui/buttonStyles";
import { FormField } from "../ui/Input";
import ModalDialog from "../ui/ModalDialog";

/** Typed in full before erasure runs, so it cannot be a mis-click. */
const CONFIRM_WORD = "DELETE";

type ErasureResponse = {
  success?: boolean;
  message?: string;
};

type Props = {
  onClose: () => void;
  onErased: (message: string) => void;
  /** The server refused because an order still needs the delivery address. */
  onBlocked: (reason: string) => void;
};

export default function ErasureDialog({
  onClose,
  onErased,
  onBlocked,
}: Props) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) {
      setError(`Type ${CONFIRM_WORD} to confirm.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/privacy/erase", { method: "POST" });
      if (!res.ok) {
        const failure = await readJson<ApiError>(res).catch(
          () => ({}) as ApiError
        );
        if (res.status === 409 && failure.error === "open_orders") {
          onBlocked(
            failure.reason ||
              "You have an order still in transit. We need your delivery details until it arrives."
          );
          return;
        }
        setError(
          failure.reason ||
            failure.message ||
            failure.error ||
            "We couldn't complete that request. Please try again, or email us."
        );
        return;
      }
      const body = await readJson<ErasureResponse>(res);
      onErased(
        body.message ||
          "Your personal details have been erased. Order records are kept in minimised form for one year, as the law requires, and then deleted."
      );
    } catch {
      setError(
        "We couldn't reach the server. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      role="alertdialog"
      title="Erase my personal data"
      description="Read what happens, then type the confirmation word."
      busy={submitting}
      onClose={onClose}
    >
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-700 marker:text-gray-400">
        <li>
          Your name, email address and phone number are replaced with
          placeholders. You will not be able to sign in again.
        </li>
        <li>
          Saved addresses, your wishlist and any back-in-stock alerts are
          deleted straight away.
        </li>
        <li>
          Reviews you have written stay on the product pages. They are no longer
          shown under your name, and the verified-buyer mark is removed.
        </li>
        <li>
          A minimised record of past orders is kept for one year from the date
          of the order — the items, the amount and the date, with your contact
          details stripped out. Tax and consumer-protection law requires us to
          keep it that long. It is deleted after that.
        </li>
      </ul>

      <form onSubmit={handleSubmit} noValidate className="mt-5">
        <FormField
          size="sm"
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={10}
        />

        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={buttonClass("secondary", "md", "sm:flex-1")}
          >
            Keep my account
          </button>
          <button
            type="submit"
            disabled={!confirmed || submitting}
            aria-busy={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-400 sm:flex-1 sm:text-[15px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Erasing
              </>
            ) : (
              "Erase my data"
            )}
          </button>
        </div>
      </form>

      <span role="status" aria-live="polite" className="sr-only">
        {submitting ? "Erasing your personal data" : ""}
      </span>
    </ModalDialog>
  );
}
