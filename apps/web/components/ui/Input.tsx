"use client";

import {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useId,
} from "react";

const fieldBase =
  "w-full rounded-xl border border-emerald-200 bg-white text-green-900 placeholder:text-gray-400 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 disabled:bg-emerald-50/60 disabled:text-gray-500";

const sizeClass = {
  md: "px-3.5 py-2.5 text-sm sm:text-[15px]",
  sm: "px-3 py-2.5 text-sm touch-manipulation",
} as const;

const labelClass = {
  md: "mb-1.5 block text-sm font-medium text-gray-700",
  sm: "mb-1.5 block text-xs font-medium text-gray-700 sm:text-sm",
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
  htmlFor,
  children,
}: FieldShellProps & { htmlFor: string; children: ReactNode }) {
  return (
    <div>
      {label ? (
        labelExtra ? (
          <div className="flex items-center justify-between">
            <label htmlFor={htmlFor} className={labelClass[size]}>
              {label}
            </label>
            {labelExtra}
          </div>
        ) : (
          <label htmlFor={htmlFor} className={labelClass[size]}>
            {label}
          </label>
        )
      ) : null}
      {children}
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

type FormFieldProps = FieldShellProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { className?: string };

/**
 * Label + `<input>` + optional hint, in the "bordered" field skin shared by
 * checkout, account and the product-admin form.
 */
export function FormField({ label, labelExtra, hint, size = "md", className = "", id, ...props }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size} htmlFor={fieldId}>
      <input id={fieldId} className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props} />
    </FieldShell>
  );
}

type FormTextareaProps = FieldShellProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { className?: string };

export function FormTextarea({ label, labelExtra, hint, size = "md", className = "", id, ...props }: FormTextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size} htmlFor={fieldId}>
      <textarea id={fieldId} className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props} />
    </FieldShell>
  );
}

type FormSelectProps = FieldShellProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { className?: string };

export function FormSelect({ label, labelExtra, hint, size = "md", className = "", id, children, ...props }: FormSelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell label={label} labelExtra={labelExtra} hint={hint} size={size} htmlFor={fieldId}>
      <select id={fieldId} className={`${fieldBase} ${sizeClass[size]} ${className}`.trim()} {...props}>
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
