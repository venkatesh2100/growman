'use client';

import Link from 'next/link';
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
} from 'react-icons/fa';
import { GiPlantSeed, GiFlowerPot } from 'react-icons/gi';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className=" bg-green-800 text-white">
      <div className="container mx-auto px-4 py-6 pt-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <FaLeaf className="w-8 h-8 text-emerald-400" />
                {/* <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-100 rounded-full animate-pulse"></div> */}
              </div>
              <h2 className="text-2xl font-bold">Growman</h2>
            </div>
            <p className="text-green-200 text-sm mb-4">
              Premium plants & gardening solutions for Indian homes
            </p>
            <div className="flex gap-3">
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
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FaShoppingBag className="w-4 h-4 text-emerald-400" />
              Shop
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/indoor-plants" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group">
                  <FaLeaf className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Indoor Plants</span>
                </Link>
              </li>
              <li>
                <Link href="/outdoor-plants" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group">
                  <GiPlantSeed className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Outdoor Plants</span>
                </Link>
              </li>
              <li>
                <Link href="/seeds" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group">
                  <FaSeedling className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Seeds</span>
                </Link>
              </li>
              <li>
                <Link href="/pots" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors group">
                  <GiFlowerPot className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>Pots & Planters</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Help */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FaHeadset className="w-4 h-4 text-emerald-400" />
              Help
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/contact" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors">
                  <span>Contact Us</span>
                </Link>
              </li>
              <li>
                <Link href="/shipping" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors">
                  <span>Shipping</span>
                </Link>
              </li>
              <li>
                <Link href="/returns" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors">
                  <span>Returns</span>
                </Link>
              </li>
              <li>
                <Link href="/faq" className="text-green-300 hover:text-white flex items-center gap-2 transition-colors">
                  <span>FAQ</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FaMapMarkerAlt className="w-4 h-4 text-emerald-400" />
              Contact
            </h3>
            <ul className="space-y-2 text-sm text-green-300">
              <li className="flex items-start gap-2">
                <FaMapMarkerAlt className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span>Kadiam, Andhra Pradesh</span>
              </li>
              <li className="flex items-center gap-2">
                <FaEnvelope className="w-3 h-3 text-emerald-400" />
                <span>growman.live@gmail.com</span>
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

        {/* Bottom */}
        <div className="border-t border-green-800 pt-6 text-center text-sm text-green-400">
          <p className="mb-2">© {currentYear} Growman. All rights reserved.</p>
          <div className="flex justify-center gap-4">
            <Link
              href="/privacy"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Privacy</span>
            </Link>
            <Link
              href="/terms"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Terms</span>
            </Link>
            <Link
              href="/shipping"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Shipping Policy</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}