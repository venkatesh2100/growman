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
  const cards = [
    {
      icon: FileText,
      title: "Bulk orders and quotations",
      body: "For landscaping, offices, events and resellers. Choose varieties and quantities and receive an itemised quotation from the nursery.",
      link: <Link href="/bulk">Request a quotation →</Link>,
    },
    {
      icon: MapPin,
      title: "Pick up at the nursery",
      body: `Add plants to your cart and choose store pickup. We set them aside at our ${business.address.locality} nursery for you to collect. ${openingHoursDisplay}.`,
      link: (
        <a href={business.mapsUrl} target="_blank" rel="noopener noreferrer">
          Get directions →
        </a>
      ),
    },
    {
      icon: Phone,
      title: "Talk to the nursery",
      body: "Not sure what suits your space, or looking for a variety you can't find? Call us and we'll help you choose.",
      link: <a href={`tel:${business.telephone}`}>Call the nursery →</a>,
    },
  ];

  return (
    <section className="border-y border-emerald-100 bg-white py-12 sm:py-16" aria-labelledby="bulk-pickup-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2
          id="bulk-pickup-heading"
          className="font-space text-xl font-semibold tracking-tight text-green-900 sm:text-2xl"
        >
          Buying in quantity, or want to see the plants first?
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm text-gray-600 sm:text-base">
          Large orders and store visits are handled by our nursery team rather than online
          checkout.
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {cards.map(({ icon: Icon, title, body, link }) => (
            <li key={title} className="flex flex-col rounded-2xl border border-emerald-100 bg-canvas p-5 sm:p-6">
              <Icon className="h-5 w-5 text-emerald-700" aria-hidden />
              <h3 className="mt-3 text-base font-semibold text-green-900">{title}</h3>
              <p className="mt-1.5 grow text-sm leading-relaxed text-gray-600">{body}</p>
              <span className="mt-4 text-sm font-semibold text-emerald-700 [&>a:hover]:text-emerald-900">
                {link}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
