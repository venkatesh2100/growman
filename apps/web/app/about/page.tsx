import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Clock,
  FileText,
  Mail,
  MapPin,
  Phone,
  Store,
  Truck,
} from "lucide-react";
import { FaInstagram } from "react-icons/fa";
import StoreLocatorMap from "../../components/about/StoreLocatorMap";
import { Card, PageHeader, PageShell, SectionHeading } from "../../components/layout/Page";
import JsonLd from "../../components/seo/JsonLd";
import ButtonLink from "../../components/ui/ButtonLink";
import { PLAY_STORE_URL } from "../../lib/appLinks";
import { getAllProducts, getIndexableCollections } from "../../lib/seo/catalog";
import { createLocalBusinessJsonLd } from "../../lib/seo/jsonLd";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { business, openingHoursDisplay } from "../../lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "About Growman — Plant Nursery in Hyderabad",
  description:
    "Growman sells nursery-grown indoor, outdoor and ornamental plants across India, backed by Shiridi Sai Nursery in Hyderabad. Contact details and opening hours.",
  path: "/about",
});

// Keep in step with CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

const WAYS_TO_BUY = [
  {
    icon: Truck,
    title: "Order online",
    body: "Pay securely by UPI, card, netbanking or wallet. The delivery fee for your address is shown at checkout.",
    link: { href: "/shop", label: "Shop plants" },
  },
  {
    icon: Store,
    title: "Pick up at the nursery",
    body: `Reserve plants from your cart and collect them in ${business.address.locality}. The store calls to confirm the amount and a time; nothing is paid online.`,
    link: { href: "/cart", label: "Go to cart" },
  },
  {
    icon: FileText,
    title: "Bulk and corporate",
    body: "For landscaping, offices, events and resellers. Send your list and we reply with an itemised quotation.",
    link: { href: "/bulk", label: "Request a quotation" },
  },
];

export default async function AboutPage() {
  const [collections, products] = await Promise.all([
    getIndexableCollections(),
    getAllProducts(),
  ]);

  const facts = [
    products.length > 0 ? { value: String(products.length), label: "plants in the catalog" } : null,
    collections.length > 0 ? { value: String(collections.length), label: "plant categories" } : null,
    { value: "7 days", label: "a week, 9 AM – 7 PM" },
    { value: "Pan-India", label: "delivery" },
  ].filter((fact): fact is { value: string; label: string } => fact !== null);

  return (
    <PageShell>
      {/* Local business details, all of which are published on this page. */}
      <JsonLd id="about-localbusiness" data={createLocalBusinessJsonLd()} />

      <PageHeader
        breadcrumbs={createBreadcrumbs([{ name: "About", path: "/about" }])}
        eyebrow="About us"
        title="About Growman"
        description={`Growman is an online plant store backed by ${business.parentOrganization} in ${business.address.locality}. We sell indoor, outdoor, ornamental, fruit and medicinal plants, selected at the nursery and delivered across India.`}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map((fact) => (
          <Card key={fact.label} className="p-4 sm:p-5">
            <dt className="sr-only">{fact.label}</dt>
            <dd>
              <span className="block font-space text-2xl font-semibold text-green-900">
                {fact.value}
              </span>
              <span className="mt-0.5 block text-sm text-gray-600">{fact.label}</span>
            </dd>
          </Card>
        ))}
      </dl>

      <section className="mt-14" aria-labelledby="buy-heading">
        <SectionHeading
          id="buy-heading"
          title="Ways to buy"
          description="Order online for delivery, collect in person, or ask for a quotation on larger orders."
        />
        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          {WAYS_TO_BUY.map(({ icon: Icon, title, body, link }) => (
            <Card key={title} className="flex flex-col p-5 sm:p-6">
              <Icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold text-green-900">{title}</h3>
              <p className="mt-1.5 grow text-sm leading-relaxed text-gray-600">{body}</p>
              <Link
                href={link.href}
                prefetch={false}
                className="mt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
              >
                {link.label} →
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-14 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <StoreLocatorMap />

        <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-32">
          <h2
            id="contact-heading"
            className="font-space text-xl font-semibold text-green-900"
          >
            Contact
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Questions about plants, orders or delivery
          </p>
          <Card className="mt-3 p-5">
            <ul className="space-y-4 text-sm text-gray-700">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <a
                  href={business.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-800"
                >
                  <address className="not-italic">
                    {business.parentOrganization}, {business.address.locality},{" "}
                    {business.address.region}
                  </address>
                  <span className="text-xs text-emerald-700 underline underline-offset-2">
                    Open in Google Maps
                  </span>
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 shrink-0 text-emerald-700" />
                {/* The number is dialled by the link rather than printed, so
                    it is not sitting in the page for scrapers to pick up. */}
                <a
                  href={`tel:${business.telephone}`}
                  className="font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Call the nursery
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-emerald-700" />
                <a
                  href={`mailto:${business.email}`}
                  className="break-all hover:text-emerald-800"
                >
                  {business.email}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-emerald-700" />
                {openingHoursDisplay}
              </li>
              <li className="flex items-center gap-3">
                <FaInstagram className="h-4 w-4 shrink-0 text-emerald-700" />
                <a
                  href="https://www.instagram.com/growman.live/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-800"
                >
                  @growman.live
                </a>
              </li>
            </ul>
          </Card>

          <Card className="mt-3 flex items-center gap-4 p-5">
            <Image
              src="/growman.png"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-green-900">Growman for Android</p>
              <p className="text-xs text-gray-500">Shop from your phone</p>
            </div>
            <ButtonLink
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              tone="secondary"
              size="sm"
            >
              Install
            </ButtonLink>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
