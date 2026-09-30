import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { PageHeader, PageShell } from "../../components/layout/Page";
import { buttonClass } from "../../components/ui/buttonStyles";
import { fetchAllProducts } from "../../lib/data";
import { quotationItemCode } from "../../lib/quotation";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { business, openingHoursDisplay } from "../../lib/seo/site";
import BulkOrderList, { type BulkItem } from "./BulkOrderList";

export const metadata: Metadata = createPageMetadata({
  title: "Bulk Plant Orders & Quotations — Wholesale from Our Hyderabad Nursery",
  description:
    "Get a bulk plant quotation from Growman for landscaping, offices, events and resale. Pick varieties and quantities, share your site details and receive an itemised quotation from our Hyderabad nursery.",
  path: "/bulk",
});

export const revalidate = 600;

const STEPS = [
  "Choose varieties and quantities",
  "Send the quotation request",
  "Our team calls to confirm pricing",
];

export default async function BulkOrderPage() {
  const { productsBySize } = await fetchAllProducts(100);

  // Stock is deliberately left out: bulk quantities are fulfilled from the
  // nursery, so online stock counts would only mislead large buyers.
  const items: BulkItem[] = productsBySize.map((product) => {
    const size = product.sizes?.[0];
    const sizeId = Number(size?.id ?? 0);
    const baseName =
      size?.label && product.name.endsWith(` - ${size.label}`)
        ? product.name.slice(0, -(size.label.length + 3))
        : product.name;
    return {
      key: `${product.id}-${sizeId || "base"}`,
      productId: Number(product.id),
      sizeId,
      itemCode: quotationItemCode(Number(product.id), sizeId),
      name: baseName,
      size: size?.label ?? "",
      slug: product.slug,
      category: product.category?.name ?? "",
      price: Number(size?.price ?? product.price) || 0,
      image: product.imageUrl || "",
    };
  });

  return (
    <PageShell width="wide">
      <PageHeader
        breadcrumbs={createBreadcrumbs([{ name: "Bulk Orders", path: "/bulk" }])}
        eyebrow="Wholesale"
        title="Bulk plant orders"
        description="For landscaping projects, offices, events and resellers. Add the varieties and quantities you need and send a quotation request. Our Hyderabad nursery confirms pricing, availability and delivery by phone."
      />

      <ol className="mb-8 grid gap-2 sm:grid-cols-3 sm:gap-3">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3 text-sm text-gray-700"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <BulkOrderList items={items} phone={business.telephone} />

      <section
        id="bulk-contact"
        aria-labelledby="bulk-contact-heading"
        className="mt-12 grid gap-6 rounded-2xl border border-emerald-100 bg-white p-6 sm:p-8 md:grid-cols-[1.2fr_1fr] md:items-center"
      >
        <div>
          <h2
            id="bulk-contact-heading"
            className="font-space text-xl font-semibold text-green-900 sm:text-2xl"
          >
            Prefer to talk it through?
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
            Bulk orders are handled directly by our nursery team. Call with your
            list, or visit the nursery to see the plants before you order.
          </p>
          <a
            href={`tel:${business.telephone}`}
            className={buttonClass("primary", "md", "mt-5")}
          >
            <Phone className="h-4 w-4" />
            Call the nursery
          </a>
        </div>

        <ul className="space-y-3 text-sm text-gray-600">
          <li className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <a
              href={business.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-800"
            >
              Nursery in {business.address.locality}
              <span className="block text-xs text-emerald-700 underline underline-offset-2">
                Open in Google Maps
              </span>
            </a>
          </li>
          <li className="flex items-center gap-3">
            <Clock className="h-4 w-4 shrink-0 text-emerald-700" />
            {openingHoursDisplay}
          </li>
          <li className="flex items-center gap-3">
            <Mail className="h-4 w-4 shrink-0 text-emerald-700" />
            <a href={`mailto:${business.email}`} className="hover:text-emerald-800">
              {business.email}
            </a>
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
