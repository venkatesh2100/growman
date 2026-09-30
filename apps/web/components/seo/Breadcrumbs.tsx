import Link from "next/link";
import JsonLd from "./JsonLd";
import { createBreadcrumbJsonLd } from "../../lib/seo/jsonLd";
import type { BreadcrumbItem } from "../../lib/seo/metadata";
import { SITE_URL } from "../../lib/seo/site";

/**
 * Visible breadcrumb trail plus its BreadcrumbList structured data, generated
 * from one list so the markup and the schema can never disagree — Google
 * ignores breadcrumb data that does not match what users see.
 *
 * `items` must be built with `createBreadcrumbs`, which guarantees canonical
 * URLs.
 */
export default function Breadcrumbs({
  items,
  className = "",
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <JsonLd data={createBreadcrumbJsonLd(items)} />
      <nav aria-label="Breadcrumb" className={className}>
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 sm:text-sm">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            // Absolute canonical URLs are stored for the schema; links use the
            // relative path so client-side navigation still works.
            const href = item.url.replace(SITE_URL, "") || "/";

            return (
              <li key={item.url} className="flex items-center gap-x-1.5">
                {isLast ? (
                  <span
                    aria-current="page"
                    className="max-w-[180px] truncate font-medium text-green-900 sm:max-w-none"
                  >
                    {item.name}
                  </span>
                ) : (
                  <>
                    <Link href={href} className="transition-colors hover:text-green-900">
                      {item.name}
                    </Link>
                    <span aria-hidden="true" className="text-gray-300">
                      /
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
