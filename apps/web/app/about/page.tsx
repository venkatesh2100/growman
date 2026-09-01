import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Footer from "../../components/hompage/footer";
import StoreLocatorMap from "../../components/about/StoreLocatorMap";
import { PLAY_STORE_URL } from "../../lib/appLinks";
import {
  FaClock,
  FaEnvelope,
  FaFacebookF,
  FaInstagram,
  FaMapMarkerAlt,
  FaPhone,
  FaSeedling,
  FaTwitter,
} from "react-icons/fa";

export const metadata: Metadata = {
  title: "About — Growman",
  description: "Premium plants and gardening for Indian homes. Visit our Hyderabad store.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#F9FAFB]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="overflow-hidden rounded-3xl bg-linear-to-br from-green-50 to-green-100 px-6 py-10 text-center sm:px-8">
          <Image
            src="/growman.png"
            alt="Growman"
            width={48}
            height={48}
            className="mx-auto mb-4 rounded-md object-cover"
          />
          <p className="font-space text-[28px] font-bold italic tracking-tight text-green-950">
            #Growman
          </p>
          <p className="mt-1.5 text-[13px] italic text-emerald-800">
            Rooted in care, grown for you.
          </p>
          <div className="mx-auto my-5 h-px w-10 bg-emerald-600/25" />
          <p className="text-[11px] text-gray-500">Growman · v2.0</p>
        </div>

        <section className="mt-8 rounded-2xl border border-emerald-100/80 bg-white p-5 sm:p-6">
          <h1 className="font-space text-2xl font-bold tracking-tight text-green-900">
            About Growman
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Premium plants and gardening solutions for Indian homes. We ship healthy plants,
            pots, and seeds across India — backed by Shiridi Sai Nursery in Kadiam, Andhra Pradesh.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800">
            <FaSeedling className="h-4 w-4 shrink-0" />
            Powered by Shiridi Sai Nursery
          </p>
        </section>

        <div className="mt-8">
          <StoreLocatorMap />
        </div>

        <section className="mt-8 rounded-2xl border border-emerald-100/80 bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold text-green-900">Contact</h2>
          <ul className="mt-4 space-y-3 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <FaMapMarkerAlt className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              Kadiam, Andhra Pradesh
            </li>
            <li className="flex items-center gap-2">
              <FaEnvelope className="h-4 w-4 shrink-0 text-emerald-600" />
              <a href="mailto:growman.live@gmail.com" className="hover:text-emerald-800">
                growman.live@gmail.com
              </a>
            </li>
            <li className="flex items-center gap-2">
              <FaPhone className="h-4 w-4 shrink-0 text-emerald-600" />
              <a href="tel:+919553570568" className="hover:text-emerald-800">
                +91 95535 70568
              </a>
            </li>
            <li className="flex items-center gap-2">
              <FaClock className="h-4 w-4 shrink-0 text-emerald-600" />
              9 AM – 7 PM (IST)
            </li>
          </ul>

          <div className="mt-5 flex gap-3">
            <a
              href="https://www.instagram.com/growman.live/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
              aria-label="Instagram"
            >
              <FaInstagram className="h-4 w-4" />
            </a>
            <a
              href="https://www.twitter.com/growman.live/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
              aria-label="Twitter"
            >
              <FaTwitter className="h-4 w-4" />
            </a>
            <a
              href="https://www.instagram.com/growman.live/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
              aria-label="Facebook"
            >
              <FaFacebookF className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-emerald-100/80 bg-[#F9FAFB] p-5 sm:p-6">
          <p className="text-sm text-gray-500">Get the Growman app</p>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            Install on Google Play →
          </a>
          <p className="mt-4">
            <Link href="/shop" className="text-sm font-medium text-gray-500 hover:text-green-900">
              Browse plants
            </Link>
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
