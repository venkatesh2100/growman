import Link from "next/link";
import { FileText, MapPin, Phone } from "lucide-react";
import { business, openingHoursDisplay } from "../../lib/seo/site";

/**
 * The three ways to buy that are not "add to cart": a bulk quotation, collecting
 * from the nursery in person, and simply calling the store.
 *
 * Every claim here is already published elsewhere on the site (the /bulk page,
 * /about and the footer) — the nursery location, the opening hours and the phone
 * number. Nothing about delivery times or pricing is asserted.
 */
export default function BulkAndPickupSection() {
  return (
    <section
      className="bg-emerald-50/50 py-8 sm:py-12 md:py-16"
      aria-labelledby="bulk-pickup-heading"
    >
      <div className="container mx-auto px-3 sm:px-4">
        <h2
          id="bulk-pickup-heading"
          className="text-2xl font-bold text-green-900 sm:text-3xl"
        >
          Buying a lot, or want to see the plants first?
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-green-800/80 sm:mt-2 sm:text-base">
          Large orders and store visits are handled by our nursery team rather
          than online checkout.
        </p>

        <ul className="mt-6 grid gap-4 sm:mt-8 sm:grid-cols-2 lg:grid-cols-3">
          <li className="rounded-xl border border-emerald-100 bg-white p-5">
            <FileText className="h-6 w-6 text-emerald-600" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold text-green-900">
              Bulk orders &amp; quotations
            </h3>
            <p className="mt-1.5 text-sm text-gray-600">
              For landscaping, offices, events or resale. Pick varieties and
              quantities, and get an itemised quotation priced by the nursery.
            </p>
            <Link
              href="/bulk"
              className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              Request a quotation →
            </Link>
          </li>

          <li className="rounded-xl border border-emerald-100 bg-white p-5">
            <MapPin className="h-6 w-6 text-emerald-600" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold text-green-900">
              Pick up at our store
            </h3>
            <p className="mt-1.5 text-sm text-gray-600">
              Add plants to your cart and choose store pickup — we set them aside
              at our {business.address.locality} nursery for you to collect.{" "}
              {openingHoursDisplay}.
            </p>
            <a
              href={business.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              Get directions →
            </a>
          </li>

          <li className="rounded-xl border border-emerald-100 bg-white p-5">
            <Phone className="h-6 w-6 text-emerald-600" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold text-green-900">
              Talk to the nursery
            </h3>
            <p className="mt-1.5 text-sm text-gray-600">
              Not sure what suits your space, or need a variety you can&apos;t
              find? Call us and we&apos;ll help you choose.
            </p>
            <a
              href={`tel:${business.telephone}`}
              className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              Contact us →
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
