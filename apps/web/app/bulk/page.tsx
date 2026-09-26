import type { Metadata } from "next";
import { FaClock, FaMapMarkerAlt, FaPhone, FaEnvelope } from "react-icons/fa";
import Breadcrumbs from "../../components/seo/Breadcrumbs";
import Footer from "../../components/hompage/footer";
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
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-3 pt-6 pb-10 sm:px-4 sm:pt-8 md:pt-10">
        <header className="mb-6">
          <Breadcrumbs
            items={createBreadcrumbs([{ name: "Bulk Orders", path: "/bulk" }])}
            className="mb-3"
          />
          <h1 className="mb-2 text-2xl font-bold text-green-800 sm:text-3xl md:text-4xl">
            Bulk Plant Orders
          </h1>
          <p className="max-w-3xl text-sm text-gray-600 sm:text-base">
            Buying for landscaping, offices, events or your own nursery? Pick
            the varieties you need, set quantities and request a quotation. Our
            Hyderabad nursery confirms bulk pricing, availability and delivery
            by phone.
          </p>
        </header>

        <BulkOrderList items={items} phone={business.telephone} />

        <section
          id="bulk-contact"
          className="mt-12 rounded-xl border border-emerald-100 bg-white p-5 sm:p-8"
        >
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            Talk to our store for bulk pricing
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 sm:text-base">
            Bulk orders are handled directly by our nursery team. Call us with
            your list, or visit the store to see the plants in person.
          </p>

          <a
            href={`tel:${business.telephone}`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-base font-semibold text-white transition hover:bg-emerald-700 active:bg-emerald-800"
          >
            <FaPhone className="h-4 w-4" />
            Contact us
          </a>

          <ul className="mt-6 grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <FaMapMarkerAlt className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <a
                href={business.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-emerald-800"
              >
                Visit our store in {business.address.locality}
                <span className="block text-xs text-emerald-700 underline underline-offset-2">
                  Open in Google Maps
                </span>
              </a>
            </li>
            <li className="flex items-center gap-2">
              <FaClock className="h-4 w-4 shrink-0 text-emerald-600" />
              {openingHoursDisplay}
            </li>
            <li className="flex items-center gap-2">
              <FaEnvelope className="h-4 w-4 shrink-0 text-emerald-600" />
              <a href={`mailto:${business.email}`} className="hover:text-emerald-800">
                {business.email}
              </a>
            </li>
          </ul>
        </section>
      </div>

      <Footer />
    </main>
  );
}
