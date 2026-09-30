import type { ReactNode } from "react";
import Breadcrumbs from "../seo/Breadcrumbs";
import type { BreadcrumbItem } from "../../lib/seo/metadata";

const widths = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
} as const;

export type PageWidth = keyof typeof widths;

/** The `<main>` wrapper every storefront page uses, so widths and gutters match. */
export function PageShell({
  children,
  width = "default",
  className = "",
}: {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  return (
    <main className={`min-h-[60vh] ${className}`.trim()}>
      <div
        className={`mx-auto ${widths[width]} px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8`}
      >
        {children}
      </div>
    </main>
  );
}

/** Title block at the top of a page: optional breadcrumbs, eyebrow, H1, lede and actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  breadcrumbs,
  actions,
  className = "",
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-8 ${className}`.trim()}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} className="mb-4" /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-emerald-700 uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-gray-600 sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A section heading with an optional supporting line and trailing link. */
export function SectionHeading({
  title,
  description,
  action,
  id,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={`mb-5 flex flex-wrap items-end justify-between gap-3 ${className}`.trim()}
    >
      <div className="max-w-2xl">
        <h2
          id={id}
          className="font-space text-xl font-semibold tracking-tight text-green-900 sm:text-2xl"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-gray-600 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** White surface used for grouped content across the site. */
export function Card({
  children,
  className = "",
  as: Tag = "div",
  "aria-labelledby": labelledBy,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li" | "aside";
  "aria-labelledby"?: string;
}) {
  return (
    <Tag
      aria-labelledby={labelledBy}
      className={`rounded-2xl border border-emerald-100 bg-white ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
