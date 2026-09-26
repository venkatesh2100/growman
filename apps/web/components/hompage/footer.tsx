import Image from "next/image";
import Link from "next/link";
import { PLAY_STORE_URL } from "../../lib/appLinks";
import { getIndexableCollections } from "../../lib/seo/catalog";
import { business } from "../../lib/seo/site";
import {
  FaInstagram,
  FaMapMarkerAlt,
  FaEnvelope,
  FaPhone,
  FaClock,
  FaSeedling,
  FaShoppingBag,
  FaHeadset,
  FaGlobeEurope,
} from "react-icons/fa";
import { GiPlantSeed, GiFlowerPot } from "react-icons/gi";

/**
 * Site footer. A server component so its links are in the HTML on every page,
 * and so the Shop column can be built from the live catalog — previously it
 * pointed at /seeds, /pots and /faq, none of which exist.
 */
export default async function Footer() {
  const currentYear = new Date().getFullYear();
  const collections = await getIndexableCollections();
  const shopLinks = collections.slice(0, 5).map(({ category }) => ({
    href: `/categories/${category.slug}`,
    label: category.name,
  }));

  return (
    <footer className=" bg-green-800 text-white">
      <div className="container mx-auto px-4  pt-8 md:pt-12">
        <div className="grid grid-cols-2 md:grid-cols-4  gap-2">
          {/* Brand */}
          <div>
            <Link
              href="/"
              className="mb-4 flex items-center gap-2 touch-manipulation"
              aria-label="Growman home"
            >
              <Image
                src="/growman.png"
                alt=""
                width={56}
                height={56}
                className="h-11 w-11 sm:h-14 sm:w-14 rounded-md object-contain"
              />
              <h2 className="text-2xl sm:text-4xl font-space font-bold">Growman</h2>
            </Link>
            <p className="text-green-200 text-sm mb-4">
              Premium plants & gardening solutions for Indian homes
            </p>
            <div className=" flex gap-3">
              {/* Only the Instagram profile URL is confirmed, so it is the
                  single social link here — the previous Facebook and Twitter
                  icons pointed at the Instagram URL and a malformed handle.
                  TODO: restore them once the real profile URLs are known. */}
              <a
                href="https://www.instagram.com/growman.live/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-300 hover:text-white hover:bg-emerald-600 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                aria-label="Growman on Instagram"
              >
                <FaInstagram className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Shop */}
          <div className="hidden md:block">
            <h3 className="font-semibold mb-3 flex items-center gap-2 ">
              <FaShoppingBag className="w-4 h-4 text-emerald-400" />
              Shop
            </h3>
            <ul className="space-y-2 text-sm">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                  >
                    <GiPlantSeed className="w-3 h-3 group-hover:scale-110 transition-transform" />
                    <span>{link.label}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/categories"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                >
                  <GiFlowerPot className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>All Categories</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Help */}
          <div className="hidden md:block">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FaHeadset className="w-4 h-4 text-emerald-400" />
              Help
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/help-center"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Help Center</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Contact Us</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/blog"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Plant Care Guides</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Terms</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy-policy"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Privacy Policy</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FaGlobeEurope className="w-4 h-4 text-emerald-400" />
              Contact
            </h3>
            <ul className="space-y-2 text-sm text-green-300">
              <li className="flex items-start gap-2">
                <FaMapMarkerAlt className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                <a
                  href={business.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <address className="not-italic">
                    Visit our store in {business.address.locality} 
                  </address>
                  {/* <span className="block text-xs text-emerald-200 mt-0.5 underline underline-offset-2">
                    Open in Google Maps
                  </span> */}
                </a>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <FaEnvelope className="text-emerald-400  text-[14px] shrink-0" />
                <a
                  href={`mailto:${business.email}`}
                  className="text-[13px] hover:text-white transition-colors"
                >
                  {business.email}
                </a>
              </li>

              <li className="flex items-center gap-2">
                <FaPhone className="w-3 h-3 text-emerald-400" />
                {/* The number is dialled by the link rather than printed, so it
                    is not sitting in the page for scrapers to pick up. */}
                <a
                  href={`tel:${business.telephone}`}
                  className="hover:text-white transition-colors"
                >
                  Contact us
                </a>
              </li>
              <li className="flex items-center gap-2">
                <FaClock className="w-3 h-3 text-emerald-400" />
                <span>9 AM - 7 PM (IST)</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col justify-between   md:flex-row items-center    text-center md:text-left">
          {/* App install — mobile */}
          {/* <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-6 flex w-full items-center mx-auto gap-4 rounded-xl p-4 text-left md:hidden"
          >
            <Image
              src="/qr-code.svg"
              alt="Install Growman app"
              height={72}
              width={72}
              className="shrink-0 rounded-lg bg-white p-1"
            />
            <div className="text-sm text-green-100 leading-tight">
              <p className="font-semibold text-white">Get the Growman app</p>
              <p className="mt-1">Install free on Google Play</p>
              <span className="mt-2 inline-block rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-green-800">
                Install on Google Play
              </span>
            </div>
          </a> */}

          {/* App install — desktop */}
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-6 hidden items-center gap-4 rounded-xl p-4 transition-colors  md:mb-0 md:flex"
          >
            <Image
              src="/qr-code.svg"
              alt="Growman app QR code"
              height={120}
              width={120}
              className="shrink-0 rounded-lg bg-white p-1"
            />
            <div className="text-sm text-green-200 leading-tight">
              <p className="font-semibold text-white">Get the Growman app</p>
              <p className="mt-1">Scan the QR or click to open Google Play</p>
              <span className="mt-2 inline-block text-xs font-medium text-emerald-300 underline">
                Install on Google Play →
              </span>
            </div>
          </a>

          <div className="font-serif italic tracking-wide text-emerald-300 text-xl">
            {/* Decorative illustration: square source, so declare it square to
                avoid a layout shift, and hide it from assistive tech. */}
            <Image
              src="/404.png"
              width={200}
              height={200}
              sizes="(max-width: 768px) 140px, 200px"
              alt=""
              aria-hidden="true"
              className="md:w-50 h-auto"
            />
          </div>

          {/* Copyright */}
          <div className="flex flex-col items-center  mb-2 md:pr-20">
            <p className="text-green-300 text-sm">
              © {currentYear} Growman. All rights reserved.
            </p>

            <p className="text-emerald-300 text-sm font-medium flex items-center gap-1 mt-1">
              <FaSeedling className="w-4 h-4" />
              Powered by Shiridi Sai Nursery
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

{
  /* <div className="flex justify-center gap-4">
            <Link
              href="/privacy"
              prefetch={false}
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Privacy</span>
            </Link>
            <Link
              href="/terms"
              prefetch={false}
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Terms</span>
            </Link>
            <Link
              href="/shipping"
              prefetch={false}
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Shipping Policy</span>
            </Link>
          </div> */
}
