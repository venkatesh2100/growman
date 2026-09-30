/**
 * Button skins as plain class strings, kept out of the "use client" Button
 * module so server components can style links with them too.
 */
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors touch-manipulation disabled:cursor-not-allowed";

const sizes = {
  sm: "px-3.5 py-2 text-sm",
  md: "px-5 py-2.5 text-sm sm:text-[15px]",
  lg: "px-6 py-3 text-base",
} as const;

const tones = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-400",
  secondary:
    "border border-emerald-700 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-60",
  ghost: "text-emerald-700 hover:bg-emerald-50 disabled:opacity-60",
} as const;

export type ButtonTone = keyof typeof tones;
export type ButtonSize = keyof typeof sizes;

export function buttonClass(
  tone: ButtonTone = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${base} ${sizes[size]} ${tones[tone]} ${extra}`.trim();
}
