"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

const variants = {
  // Full-width emerald action button used across checkout/account/product forms.
  // (gap-2 replaces the mr-2 each icon used to carry for icon/spinner-to-text spacing.)
  solid:
    "w-full bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2",
  // Same, with the mobile-tuned sizing checkout uses for its primary CTA.
  "solid-sm":
    "w-full bg-emerald-600 text-white py-2.5 sm:py-3 rounded-lg font-semibold hover:bg-emerald-700 active:bg-emerald-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base touch-manipulation",
  // Pill-shaped primary button used on the login/signup/forgot-password screens.
  "pill-primary":
    "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60",
  // Pill-shaped secondary/outline button (e.g. "Resend code") on the same screens.
  "pill-secondary":
    "flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-white px-4 py-4 text-sm font-semibold text-green-900 transition-colors hover:bg-emerald-50/60",
} as const;

export type ButtonVariant = keyof typeof variants;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner + loadingText in place of the normal icon/children. */
  loading?: boolean;
  loadingText?: ReactNode;
  icon?: ReactNode;
}

/**
 * Shared action button covering the two button "skins" used across the app
 * (rounded-lg solid buttons in checkout/account/product forms, and the rounded-2xl
 * pill buttons on the auth screens), with a built-in loading-spinner state so call
 * sites don't each re-implement the `{loading ? <spinner/> : <icon/label>}` ternary.
 */
export function Button({
  variant = "solid",
  loading = false,
  loadingText,
  icon,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${variants[variant]} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          {loadingText}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
