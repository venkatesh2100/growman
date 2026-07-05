"use client";
import Image from "next/image";
import Link from "next/link";
import { PLAY_STORE_URL } from "../../lib/appLinks";
import {
  FaFacebookF,
  FaInstagram,
  FaTwitter,
  FaLeaf,
  FaMapMarkerAlt,
  FaEnvelope,
  FaPhone,
  FaClock,
  FaSeedling,
  FaShoppingBag,
  FaHeadset,
  FaAddressBook,
  FaGlobeEurope,
  FaGlobeAsia,
} from "react-icons/fa";
import { GiPlantSeed, GiFlowerPot } from "react-icons/gi";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className=" bg-green-800 text-white">
      <div className="container mx-auto px-4  pt-8 md:pt-12">
        <div className="grid grid-cols-2 md:grid-cols-4  gap-2">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                {/* <Image src="/logo.png" width={30} height={20} alt="logo" /> */}
                <FaLeaf className="w-8 h-8 text-emerald-400" />
                {/* <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-100 rounded-full animate-pulse"></div> */}
              </div>
              <h2 className="text-2xl font-bold">Growman</h2>
            </div>
            <p className="text-green-200 text-sm mb-4">
              Premium plants & gardening solutions for Indian homes
            </p>
            <div className=" flex gap-3">
              <a
                href="#"
                className="text-green-300 hover:text-white hover:bg-emerald-600 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                aria-label="Facebook"
              >
                <FaFacebookF className="w-4 h-4" />
              </a>
              <a
                href="#"
                className="text-green-300 hover:text-white hover:bg-emerald-600 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                aria-label="Instagram"
              >
                <FaInstagram className="w-4 h-4" />
              </a>
              <a
                href="#"
                className="text-green-300 hover:text-white hover:bg-emerald-600 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                aria-label="Twitter"
              >
                <FaTwitter className="w-4 h-4" />
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
              <li>
                <Link
                  href="/categories/indoor-plants"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                >
                  <FaLeaf className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Indoor Plants</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/categories/outdoor-plants"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                >
                  <GiPlantSeed className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Outdoor Plants</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/seeds"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                >
                  <FaSeedling className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Seeds</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/pots"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group"
                >
                  <GiFlowerPot className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Pots & Planters</span>
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
                  href="/account"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Contact Us</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/orders"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Shipping</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/orders"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>Returns</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  prefetch={false}
                  className="text-green-300 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <span>FAQ</span>
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
                <span>Kadiam, Andhra Pradesh</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <FaEnvelope className="text-emerald-400  text-[14px] shrink-0" />
                <span className="text-[13px]">growman.live@gmail.com</span>
              </li>

              <li className="flex items-center gap-2">
                <FaPhone className="w-3 h-3 text-emerald-400" />
                <span>+91 93463 95054</span>
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
            <Image src="/404.png" width={140} height={240} alt="404"  className="md:w-50 " />
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
