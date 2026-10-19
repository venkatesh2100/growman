"use client";

import { useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import ModalDialog from "./ModalDialog";
import { buttonClass } from "./buttonStyles";

const confirmTone = {
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-400 sm:flex-1 sm:text-[15px]",
  primary: buttonClass("primary", "md", "sm:flex-1"),
} as const;

type Props = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  busy?: boolean;
  tone?: keyof typeof confirmTone;
  onConfirm: () => void;
  onClose: () => void;
};

/** A yes/no step for an action that cannot be undone. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel,
  busy = false,
  tone = "danger",
  onConfirm,
  onClose,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      role="alertdialog"
      title={title}
      busy={busy}
      initialFocusRef={cancelRef}
      onClose={onClose}
      className="sm:max-w-md"
    >
      <div className="space-y-2 text-sm leading-relaxed text-gray-600">
        {children}
      </div>

      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        <button
          ref={cancelRef}
          type="button"
          onClick={onClose}
          disabled={busy}
          className={buttonClass("secondary", "md", "sm:flex-1")}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
          className={confirmTone[tone]}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {busyLabel}
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {busy ? busyLabel : ""}
      </span>
    </ModalDialog>
  );
}
