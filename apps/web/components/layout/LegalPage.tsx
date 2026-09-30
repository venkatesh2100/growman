import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader, PageShell } from "./Page";
import { createBreadcrumbs } from "../../lib/seo/metadata";
import { business } from "../../lib/seo/site";

export type LegalSection = { title: string; body: ReactNode };

/** Shared layout for the terms and privacy pages. */
export default function LegalPage({
  title,
  path,
  intro,
  updated,
  sections,
}: {
  title: string;
  path: string;
  intro?: string;
  updated?: string;
  sections: LegalSection[];
}) {
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={createBreadcrumbs([{ name: title, path }])}
        title={title}
        description={
          <>
            {intro}
            {updated ? <span className="mt-1 block text-xs text-gray-500">Last updated: {updated}</span> : null}
          </>
        }
      />

      <div className="rounded-2xl border border-emerald-100 bg-white p-6 sm:p-8">
        <ol className="space-y-7">
          {sections.map((section, index) => (
            <li key={section.title}>
              <h2 className="text-base font-semibold text-green-900">
                <span className="mr-2 text-gray-400">{index + 1}.</span>
                {section.title}
              </h2>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">{section.body}</div>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-6 text-sm text-gray-600">
        Questions about this page? Email{" "}
        <a href={`mailto:${business.email}`} className="font-medium text-emerald-700 hover:text-emerald-900">
          {business.email}
        </a>{" "}
        or visit the{" "}
        <Link href="/help-center" className="font-medium text-emerald-700 hover:text-emerald-900">
          Help Center
        </Link>
        .
      </p>
    </PageShell>
  );
}
