import Image from "next/image";
import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { FaInstagram } from "react-icons/fa";
import { PLAY_STORE_URL } from "../../lib/appLinks";
import { getIndexableCollections } from "../../lib/seo/catalog";
import { business, openingHoursDisplay } from "../../lib/seo/site";

type FooterLink = { href: string; label: string };

const SERVICE_LINKS: FooterLink[] = [
  { href: "/gifting", label: "Plant gifting" },
  { href: "/bulk", label: "Bulk orders" },
  { href: "/blog", label: "Plant care guides" },
];

const HELP_LINKS: FooterLink[] = [
  { href: "/help-center", label: "Help Center" },
  { href: "/orders", label: "Track an order" },
  { href: "/about", label: "About us" },
  { href: "/delete-account", label: "Delete account" },
];

const linkClass = "text-sm text-green-300 transition-colors hover:text-white";

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h2 className="font-semibold text-white">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false} className={linkClass}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Site footer, rendered once from the root layout. A server component so its
 * links are in the HTML on every page, and so the Shop column is built from
 * the live catalog.
 */
export default async function Footer() {
  const currentYear = new Date().getFullYear();
  const collections = await getIndexableCollections();
  const shopLinks: FooterLink[] = [
    { href: "/shop", label: "All plants" },
    ...collections.slice(0, 5).map(({ category }) => ({
      href: `/categories/${category.slug}`,
      label: category.name,
    })),
  ];

  return (
    <footer className="bg-green-800 text-white">
      <div className="mx-auto max-w-7xl px-4 pt-12 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <Link href="/" className="inline-flex items-center gap-2" aria-label="Growman home">
              <Image
                src="/growman.png"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-md object-contain"
              />
              <span className="font-space text-2xl font-bold text-white sm:text-3xl">Growman</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-green-200">
              Plants grown at {business.parentOrganization} in{" "}
              {business.address.locality}, delivered across India.
            </p>

            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-3 rounded-xl border border-green-700 bg-green-900/40 p-2 pr-4 transition-colors hover:border-emerald-400"
            >
              <Image
                src="/qr-code.svg"
                alt=""
                width={56}
                height={56}
                className="hidden h-14 w-14 rounded-md bg-white p-1 md:block"
              />
              <span className="text-sm leading-tight">
                <span className="block font-semibold text-white">Growman for Android</span>
                <span className="text-green-200">Get it on Google Play</span>
              </span>
            </a>

            <div className="mt-6 flex gap-2">
              {/* Instagram is the only confirmed profile; add others to
                  `business.sameAs` first so structured data stays in step. */}
              <a
                href="https://www.instagram.com/growman.live/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-full text-green-300 transition-all duration-300 hover:bg-emerald-600 hover:text-white"
                aria-label="Growman on Instagram"
              >
                <FaInstagram className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-8">
            <FooterColumn title="Shop" links={shopLinks} />
            <FooterColumn title="Services" links={SERVICE_LINKS} />
            <FooterColumn title="Help" links={HELP_LINKS} />

            <div>
              <h2 className="font-semibold text-white">Contact</h2>
              <ul className="mt-4 space-y-3 text-sm">
                <li>
                  <a
                    href={business.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${linkClass} flex items-start gap-2`}
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <address className="not-italic">
                      Nursery in {business.address.locality}
                    </address>
                  </a>
                </li>
                <li>
                  {/* Dialled by the link rather than printed, so the number is
                      not sitting in the page for scrapers to pick up. */}
                  <a
                    href={`tel:${business.telephone}`}
                    className={`${linkClass} flex items-center gap-2`}
                  >
                    <Phone className="h-4 w-4 shrink-0 text-emerald-400" />
                    Call us
                  </a>
                </li>
                <li>
                  <a
                    href={`mailto:${business.email}`}
                    className={`${linkClass} flex items-center gap-2 break-all`}
                  >
                    <Mail className="h-4 w-4 shrink-0 text-emerald-400" />
                    {business.email.split("@")[0]}
                  </a>
                </li>
                <li className="flex items-start gap-2 text-green-200">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {openingHoursDisplay}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-green-700 pt-6 text-xs text-green-200 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {currentYear} Growman · Powered by {business.parentOrganization}
          </p>
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/terms" prefetch={false} className="hover:text-white">
              Terms
            </Link>
            <Link href="/privacy-policy" prefetch={false} className="hover:text-white">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
