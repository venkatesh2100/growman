import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  Check,
  Clock,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { PageShell, SectionHeading } from "../../components/layout/Page";
import Breadcrumbs from "../../components/seo/Breadcrumbs";
import CollectionCards, {
  type CollectionCard,
} from "../../components/productspage/CollectionCards";
import ButtonLink from "../../components/ui/ButtonLink";
import { buttonClass } from "../../components/ui/buttonStyles";
import { getTagCollections } from "../../lib/seo/catalog";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { business, openingHoursDisplay } from "../../lib/seo/site";
import { buildFilterHref } from "../../lib/shopFilters";

export const metadata: Metadata = createPageMetadata({
  title: "Plant Gifting — Gift Plants for Every Occasion",
  description:
    "Gift plants from Growman for birthdays, housewarmings, festivals and corporate occasions. Grown at our Hyderabad nursery and delivered across India, with planters and message cards on request.",
  path: "/gifting",
});

// Keep in step with CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

/** The gift catalog lives in the shop behind the `gift` tag. */
const GIFT_PLANTS_HREF = buildFilterHref({ type: "tag", value: "gift" });

/** WhatsApp deep link on the published store number, prefilled for gifting. */
const WHATSAPP_HREF = `https://wa.me/${business.telephone.replace(
  /\D/g,
  ""
)}?text=${encodeURIComponent(
  "Hello Growman, I would like help choosing plants as a gift."
)}`;

const OCCASIONS = [
  {
    tag: "gift",
    title: "All gift plants",
    description: "The complete gift collection, ready to send.",
  },
  {
    tag: "good-luck",
    title: "Festivals and good luck",
    description: "Traditional varieties for Diwali, housewarmings and new beginnings.",
  },
  {
    tag: "office",
    title: "Office and desk",
    description: "Compact plants for desks, reception areas and workspaces.",
  },
  {
    tag: "stress-free",
    title: "Easy care",
    description: "Hardy plants for recipients who are new to plants.",
  },
  {
    tag: "air purify",
    title: "Air-purifying",
    description: "Foliage plants suited to bedrooms, living rooms and offices.",
  },
  {
    tag: "bonsai",
    title: "Bonsai",
    description: "Shaped, long-lived plants for milestone occasions.",
  },
] as const;

const STEPS = [
  {
    title: "Choose a plant",
    body: "Browse the gift collection, or send us the occasion and budget and we will suggest options.",
  },
  {
    title: "Add a planter and message",
    body: "Share your planter choice and the message for the handwritten card with our team by WhatsApp or phone.",
  },
  {
    title: "We pack and deliver",
    body: "Plants are packed for transit and delivered across India, to the recipient or to you.",
  },
];

const CORPORATE_POINTS = [
  "Volume pricing confirmed by the nursery",
  "Delivery to one address or several",
  "Planters, presentation and branding agreed per order",
];

const CONTACT_CARD =
  "flex items-start gap-3 rounded-xl border border-emerald-100 bg-white p-4 transition-colors hover:border-emerald-300";

export default async function GiftingPage() {
  const collections = await getTagCollections(OCCASIONS.map((o) => o.tag));
  const cards: CollectionCard[] = OCCASIONS.map((occasion, index) => ({
    href: buildFilterHref({ type: "tag", value: occasion.tag }),
    title: occasion.title,
    description: occasion.description,
    productCount: collections[index]?.productCount,
    image: collections[index]?.image ?? null,
  }));

  return (
    <PageShell>
      <Breadcrumbs
        items={createBreadcrumbs([{ name: "Gifting", path: "/gifting" }])}
        className="mb-5"
      />

      <section className="grid overflow-hidden rounded-3xl border border-emerald-100 bg-white md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col justify-center p-6 sm:p-10">
          <p className="text-xs font-semibold tracking-[0.14em] text-emerald-700 uppercase">
            Gifting
          </p>
          <h1 className="mt-2 font-space text-3xl font-semibold tracking-tight text-green-900 sm:text-4xl">
            Plant gifts for every occasion
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600 sm:text-base">
            Birthdays, weddings, housewarmings, festivals and client gifts.
            Choose a plant, add a planter and a card, and we deliver it anywhere
            in India.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={GIFT_PLANTS_HREF} prefetch={false}>
              Shop gift plants
            </ButtonLink>
            <a href="#corporate" className={buttonClass("secondary")}>
              Corporate gifting
            </a>
          </div>
          <ul className="mt-8 grid gap-2 text-sm text-gray-600 sm:grid-cols-3 sm:gap-4">
            {[
              `Grown in ${business.address.locality}`,
              "Handwritten card on request",
              "Delivery across India",
            ].map((point) => (
              <li key={point} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative hidden min-h-72 md:block">
          <Image
            src="/plant.avif"
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 1152px) 45vw, 520px"
            // Preloaded because it is the LCP element on desktop.
            priority
            className="object-cover"
          />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="occasions-heading">
        <SectionHeading
          id="occasions-heading"
          title="Shop by occasion"
          description="Each collection opens the matching plants in the shop."
        />
        <CollectionCards cards={cards} />
      </section>

      <section className="mt-14" aria-labelledby="how-heading">
        <SectionHeading id="how-heading" title="How gifting works" />
        <ol className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-2xl border border-emerald-100 bg-white p-5"
            >
              <span className="text-sm font-semibold text-emerald-700">
                Step {index + 1}
              </span>
              <h3 className="mt-2 text-base font-semibold text-green-900">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="corporate"
        aria-labelledby="corporate-heading"
        className="mt-14 scroll-mt-32 grid gap-8 rounded-3xl bg-green-800 p-6 text-green-100 sm:p-10 md:grid-cols-[1.3fr_1fr] md:items-center"
      >
        <div>
          <Building2 className="h-6 w-6 text-emerald-400" aria-hidden="true" />
          <h2
            id="corporate-heading"
            className="mt-3 font-space text-2xl font-semibold tracking-tight text-white sm:text-3xl"
          >
            Corporate and bulk gifting
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed sm:text-base">
            Client gifts, employee welcome kits, festive hampers and event
            giveaways. Our nursery team prepares a quotation covering varieties,
            quantities, presentation and delivery.
          </p>
          <ul className="mt-5 space-y-2 text-sm">
            {CORPORATE_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 sm:p-6">
          <p className="text-sm text-green-100">
            Send us the plants and quantities you need and we will call back with
            pricing.
          </p>
          <Link
            href="/bulk"
            prefetch={false}
            className="mt-4 flex w-full items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 sm:text-[15px]"
          >
            Request a quotation
          </Link>
          <a
            href={`tel:${business.telephone}`}
            className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-white hover:text-emerald-300"
          >
            <Phone className="h-4 w-4" />
            Or call the nursery
          </a>
        </div>
      </section>

      <section
        id="gifting-contact"
        aria-labelledby="contact-heading"
        className="mt-14 scroll-mt-32"
      >
        <SectionHeading
          id="contact-heading"
          title="Need help choosing?"
          description="Tell us the occasion, the number of gifts and your budget. We will confirm what is in season, how it will be packed and when it can arrive."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* The number is dialled by the link rather than printed, so it is
              not sitting in the page for scrapers to pick up. */}
          <a href={`tel:${business.telephone}`} className={CONTACT_CARD}>
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span>
              <span className="block text-sm font-semibold text-green-900">Call</span>
              <span className="mt-0.5 block text-sm text-gray-600">
                Fastest for gift orders
              </span>
            </span>
          </a>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className={CONTACT_CARD}
          >
            <FaWhatsapp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span>
              <span className="block text-sm font-semibold text-green-900">WhatsApp</span>
              <span className="mt-0.5 block text-sm text-gray-600">
                Share the occasion and budget
              </span>
            </span>
          </a>
          <a href={`mailto:${business.email}`} className={CONTACT_CARD}>
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-green-900">Email</span>
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
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span>
              <span className="block text-sm font-semibold text-green-900">Visit</span>
              <address className="mt-0.5 block text-sm text-gray-600 not-italic">
                Our nursery in {business.address.locality}
              </address>
            </span>
          </a>
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-500">
          <Clock className="h-4 w-4 shrink-0 text-emerald-700" />
          {openingHoursDisplay}
        </p>
      </section>
    </PageShell>
  );
}
