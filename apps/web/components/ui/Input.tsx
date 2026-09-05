"use client";

import {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const fieldBase =
  "w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";

const sizeClass = {
  md: "px-4 py-2",
  sm: "px-3 sm:px-4 py-2 text-sm sm:text-base touch-manipulation",
} as const;

const labelClass = {
  md: "block text-sm font-medium text-gray-700 mb-2",
  sm: "block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2",
} as const;

export type FieldSize = keyof typeof sizeClass;

interface FieldShellProps {
  label?: ReactNode;
  /** Extra content rendered inline next to the label, e.g. a "Locate me" action. */
  labelExtra?: ReactNode;
  hint?: ReactNode;
  size?: FieldSize;
}

function FieldShell({
  label,
  labelExtra,
  hint,
  size = "md",
  children,
}: FieldShellProps & { children: ReactNode }) {
  return (
    <div>
      {label ? (
        labelExtra ? (
          <div className="flex items-center justify-between">
            <label className={labelClass[size]}>{label}</label>
            {labelExtra}
          </div>
        ) : (
          <label className={labelClass[size]}>{label}</label>
        )
      ) : null}
      {children}
      {hint ? <p className="text-xs text-gray-500 mt-1">{hint}</p> : null}
    </div>
  );
}

type FormFieldProps = FieldShellProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { className?: string };

/**
 * Label + `<input>` + optional hint, in the "bordered" field skin shared by
 * checkout, account and the product-admin form. Replaces the
 * `w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 ...` markup that
 * used to be retyped at every field.
 */
export function FormField({ label, labelExtra, hint, size = "md", className = "", ...props }: FormFieldProps) {
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size}>
      <input className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props} />
    </FieldShell>
  );
}

type FormTextareaProps = FieldShellProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { className?: string };

export function FormTextarea({ label, labelExtra, hint, size = "md", className = "", ...props }: FormTextareaProps) {
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size}>
      <textarea className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props} />
    </FieldShell>
  );
}

type FormSelectProps = FieldShellProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { className?: string };

export function FormSelect({ label, labelExtra, hint, size = "md", className = "", children, ...props }: FormSelectProps) {
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size}>
      <select className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

/**
 * The 6-digit OTP box shared by the signup and forgot-password verification steps.
 */
export function OtpField(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={6}
      placeholder="000000"
      className="w-full rounded-2xl border border-emerald-100 bg-white px-4 py-4 text-center text-2xl tracking-[0.4em] text-gray-900 placeholder:tracking-[0.4em] placeholder:text-gray-300 focus:outline-none"
      {...props}
    />
  );
}

interface PillFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  trailing?: ReactNode;
  wrapperClassName?: string;
}

/**
 * Icon-prefixed pill input used on the login/signup/forgot-password screens
 * (`rounded-2xl border border-emerald-100` wrapper with an inline leading icon and
 * an optional trailing action like the password show/hide toggle).
 */
export function PillField({ icon, trailing, wrapperClassName = "", className = "", ...props }: PillFieldProps) {
  return (
    <div className={`flex items-center rounded-2xl border border-emerald-100 bg-white px-4 ${wrapperClassName}`.trim()}>
      {icon}
      <input
        className={`w-full bg-transparent py-4 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none ${
          trailing ? "pr-2" : ""
        } ${className}`.trim()}
        {...props}
      />
      {trailing}
    </div>
  );
}
