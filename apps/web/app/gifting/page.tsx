import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  FaClock,
  FaEnvelope,
  FaMapMarkerAlt,
  FaPhone,
  FaWhatsapp,
} from "react-icons/fa";
import Breadcrumbs from "../../components/seo/Breadcrumbs";
import Footer from "../../components/hompage/footer";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { business, openingHoursDisplay } from "../../lib/seo/site";
import { buildFilterHref } from "../../lib/shopFilters";

export const metadata: Metadata = createPageMetadata({
  title: "Plant Gifting — Gift Plants for Every Occasion",
  description:
    "Gift a plant instead of something that gets thrown away. Growman puts together gift-ready plants, planters and corporate gifting from our Hyderabad nursery, delivered across India.",
  path: "/gifting",
});

/** The gift catalog lives in the shop behind the `gift` tag. */
const GIFT_PLANTS_HREF = buildFilterHref({ type: "tag", value: "gift" });

/** WhatsApp deep link on the published store number, prefilled for gifting. */
const WHATSAPP_HREF = `https://wa.me/${business.telephone.replace(
  /\D/g,
  ""
)}?text=${encodeURIComponent(
  "Hi Growman, I'd like help choosing plants as a gift."
)}`;

const REASONS = [
  {
    title: "It keeps growing",
    body: "A plant is still around next year, and the year after. It becomes a reminder of the person who sent it rather than something that gets put away in a drawer.",
  },
  {
    title: "It works for anyone",
    body: "Colleagues, in-laws, a new neighbour, someone moving into their first home — a plant lands well without needing to guess anyone's taste or size.",
  },
  {
    title: "It earns its place",
    body: "Indoor greens clean up the air in a room, take very little looking after, and sit happily on a desk, a sill or a shelf.",
  },
];

const OFFERINGS = [
  {
    title: "Plants people actually keep",
    body: "Succulents and cacti, money plants and other good-luck varieties, air-purifying foliage and flowering plants — all grown at our own nursery, so they leave healthy.",
    action: { label: "Browse gift plants", href: GIFT_PLANTS_HREF },
  },
  {
    title: "The planter to go with it",
    body: "Pair any plant with a ceramic, metal or desk planter so the gift arrives finished, not as a plastic nursery bag.",
    action: { label: "See all plants and planters", href: "/shop" },
  },
  {
    title: "A note in your words",
    body: "Tell us what to write and we'll send a handwritten card along with the plant. Wrapping and presentation can be matched to the occasion.",
    action: { label: "Ask us about packaging", href: "#gifting-contact" },
  },
  {
    title: "Corporate and bulk gifting",
    body: "Client thank-yous, employee welcome kits, Diwali hampers and event return gifts. Bulk pricing is confirmed by our nursery team, with delivery to one address or many.",
    action: { label: "Request a bulk quotation", href: "/bulk" },
  },
];

const STEPS = [
  {
    title: "Pick the plant",
    body: "Start with the gift collection, or send us the occasion and budget and we'll shortlist a few options for you.",
  },
  {
    title: "Tell us how to present it",
    body: "Planter, wrapping and the message on the card. For corporate orders this is where branding and quantities are agreed.",
  },
  {
    title: "We deliver it",
    body: "Packed to travel and shipped across India, to the recipient's address or yours if you want to hand it over yourself.",
  },
];

const OCCASIONS = [
  { label: "Good luck & festivals", href: buildFilterHref({ type: "tag", value: "good-luck" }) },
  { label: "Desk & office gifts", href: buildFilterHref({ type: "tag", value: "office" }) },
  { label: "Low-maintenance gifts", href: buildFilterHref({ type: "tag", value: "stress-free" }) },
  { label: "Air-purifying picks", href: buildFilterHref({ type: "tag", value: "air purify" }) },
  { label: "Bonsai", href: buildFilterHref({ type: "tag", value: "bonsai" }) },
  { label: "All gift plants", href: GIFT_PLANTS_HREF },
];

const CONTACT_CARD =
  "flex items-start gap-3 rounded-xl border border-emerald-100 bg-white p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60";

export default function GiftingPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-12 sm:px-4 sm:pt-8 md:pt-10">
        <Breadcrumbs
          items={createBreadcrumbs([{ name: "Gifting", path: "/gifting" }])}
          className="mb-4"
        />

        {/* Hero */}
        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-linear-to-br from-green-50 to-emerald-100">
          <div className="grid items-center gap-6 p-6 sm:p-8 md:grid-cols-[1.15fr_1fr] md:gap-8 md:p-10">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700 uppercase">
                Gifting
              </p>
              <h1 className="mt-3 font-space text-3xl font-bold tracking-tight text-green-900 sm:text-4xl">
                Give something that keeps growing
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-gray-700 sm:text-base">
                Birthdays, weddings, housewarmings, Diwali, a thank-you to a
                client — a plant says it without ending up unused. We grow ours
                at Shiridi Sai Nursery in Hyderabad and send them out gift-ready
                across India.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={GIFT_PLANTS_HREF}
                  prefetch={false}
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:bg-emerald-800 sm:text-base"
                >
                  Shop gift plants
                </Link>
                <a
                  href="#gifting-contact"
                  className="inline-flex items-center rounded-lg border border-emerald-600 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 sm:text-base"
                >
                  Talk to our gifting team
                </a>
              </div>
            </div>

            <Image
              src="/plant.avif"
              alt=""
              aria-hidden="true"
              width={480}
              height={480}
              sizes="420px"
              // Preloaded because it is the LCP element on desktop, where the
              // hero is the first thing painted.
              priority
              className="hidden h-56 w-full rounded-2xl object-cover md:block md:h-64"
            />
          </div>
        </section>

        {/* Why gift plants */}
        <section className="mt-12">
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            Why gift a plant
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {REASONS.map((reason) => (
              <div
                key={reason.title}
                className="rounded-2xl border border-emerald-100 bg-white p-5"
              >
                <h3 className="text-base font-semibold text-green-900">
                  {reason.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  {reason.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* What we offer */}
        <section className="mt-12">
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            What we can put together
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {OFFERINGS.map((offering) => (
              <div
                key={offering.title}
                className="flex flex-col rounded-2xl border border-emerald-100 bg-white p-5"
              >
                <h3 className="text-base font-semibold text-green-900">
                  {offering.title}
                </h3>
                <p className="mt-2 grow text-sm leading-relaxed text-gray-600">
                  {offering.body}
                </p>
                {offering.action.href.startsWith("#") ? (
                  <a
                    href={offering.action.href}
                    className="mt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-900 hover:underline"
                  >
                    {offering.action.label} →
                  </a>
                ) : (
                  <Link
                    href={offering.action.href}
                    prefetch={false}
                    className="mt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-900 hover:underline"
                  >
                    {offering.action.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mt-12">
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            How it works
          </h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-emerald-100 bg-white p-5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-base font-semibold text-green-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Occasions */}
        <section className="mt-12 rounded-2xl border border-emerald-100 bg-white p-5 sm:p-8">
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            Start from the occasion
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 sm:text-base">
            Each of these opens the matching set of plants in the shop. Not sure
            which fits? Send us the occasion and we&apos;ll suggest a few.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {OCCASIONS.map((occasion) => (
              <Link
                key={occasion.label}
                href={occasion.href}
                prefetch={false}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-100"
              >
                {occasion.label}
              </Link>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section
          id="gifting-contact"
          className="mt-12 scroll-mt-24 rounded-2xl border border-emerald-100 bg-white p-5 sm:p-8"
        >
          <h2 className="text-xl font-bold text-green-900 sm:text-2xl">
            Talk to our gifting team
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 sm:text-base">
            Tell us the occasion, how many gifts you need and your budget. Our
            nursery team confirms what is in season, how it will be packed and
            when it can reach.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {/* The number is dialled by the link rather than printed, so it is
                not sitting in the page for scrapers to pick up. */}
            <a href={`tel:${business.telephone}`} className={CONTACT_CARD}>
              <FaPhone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold text-green-900">
                  Call us
                </span>
                <span className="mt-0.5 block text-sm text-gray-600">
                  Quickest way to sort out a gift order
                </span>
              </span>
            </a>

            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className={CONTACT_CARD}
            >
              <FaWhatsapp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold text-green-900">
                  WhatsApp us
                </span>
                <span className="mt-0.5 block text-sm text-gray-600">
                  Share the occasion and we&apos;ll send options
                </span>
              </span>
            </a>

            <a href={`mailto:${business.email}`} className={CONTACT_CARD}>
              <FaEnvelope className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold text-green-900">
                  Email us
                </span>
                <span className="mt-0.5 block text-sm break-all text-gray-600">
                  {business.email}
                </span>
              </span>
            </a>

            <a
              href={business.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={CONTACT_CARD}
            >
              <FaMapMarkerAlt className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold text-green-900">
                  Visit the nursery
                </span>
                <address className="mt-0.5 block text-sm not-italic text-gray-600">
                  {business.address.locality} — open in Google Maps
                </address>
              </span>
            </a>
          </div>

          <p className="mt-5 flex items-center gap-2 text-sm text-gray-600">
            <FaClock className="h-4 w-4 shrink-0 text-emerald-600" />
            {openingHoursDisplay}
          </p>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-6">
            <Link
              href={GIFT_PLANTS_HREF}
              prefetch={false}
              className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              Shop gift plants
            </Link>
            <Link
              href="/bulk"
              prefetch={false}
              className="inline-flex items-center rounded-lg border border-emerald-600 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
            >
              Request bulk gifting options
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
