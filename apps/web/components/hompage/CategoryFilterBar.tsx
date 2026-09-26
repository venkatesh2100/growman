"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { buildFilterHref, type ShopFilter } from "../../lib/shopFilters";

const ChevronDown = ({ className = "" }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`h-4 w-4 ml-1 ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

type NavItem = { label: string; filter: ShopFilter };

type NavGroup = {
  name: string;
  icon: React.ReactNode;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    name: "Plants",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: "Indoor Plants", filter: { type: "category", value: "indoor-plants" } },
      { label: "Outdoor Plants", filter: { type: "category", value: "outdoor-plants" } },
      { label: "Avenue Trees", filter: { type: "category", value: "avenue" } },
      { label: "Ornamental Plants", filter: { type: "category", value: "ornamental-plants" } },
      { label: "Foliage Plants", filter: { type: "tag", value: "foliage" } },
      { label: "Air Purifying", filter: { type: "subcategory", category: "indoor-plants", value: "air-purifying" } },
      { label: "Low Light Plants", filter: { type: "subcategory", category: "indoor-plants", value: "low-light-plants" } },
      { label: "Bonsai", filter: { type: "tag", value: "bonsai" } },
    ],
  },
  {
    name: "Gifts",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5 5a3 3 0 015-2.236A3 3 0 0114.83 6H16a2 2 0 110 4h-5V9a1 1 0 10-2 0v1H4a2 2 0 110-4h1.17C5.06 5.687 5 5.35 5 5zm4 1V5a1 1 0 10-1 1h1zm3 0a1 1 0 10-1-1v1h1z" clipRule="evenodd" />
        <path d="M9 11H5v6a2 2 0 002 2h4v-8zm2 8v-8h4v6a2 2 0 01-2 2h-2z" />
      </svg>
    ),
    items: [
      { label: "Gift Plants", filter: { type: "tag", value: "gift" } },
      { label: "Good Luck Plants", filter: { type: "tag", value: "good-luck" } },
      { label: "Office Plants", filter: { type: "tag", value: "office" } },
      { label: "Corporate Gifts", filter: { type: "tag", value: "office" } },
    ],
  },
  {
    name: "By Feature",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: "Air Purifying", filter: { type: "tag", value: "air purify" } },
      { label: "Low Light Tolerant", filter: { type: "tag", value: "low-light" } },
      { label: "Medicinal Plants", filter: { type: "tag", value: "medicinal" } },
      { label: "Easy Care", filter: { type: "tag", value: "stress-free" } },
      { label: "Topiary", filter: { type: "tag", value: "Topiary" } },
      { label: "Decorational", filter: { type: "tag", value: "Decorational" } },
    ],
  },
  {
    name: "Browse All",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: "All Plants", filter: { type: "category", value: "indoor-plants" } },
      { label: "Outdoor Collection", filter: { type: "category", value: "outdoor-plants" } },
      { label: "Avenue Trees", filter: { type: "category", value: "avenue" } },
    ],
  },
];

const linkClass =
  "flex items-center px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm md:text-base text-emerald-800 font-medium hover:text-emerald-700 active:text-emerald-900 hover:bg-white active:bg-emerald-50 rounded-lg transition-colors whitespace-nowrap border border-emerald-200 shadow-sm touch-manipulation";

export default function CategoryFilterBar({ show }: { show: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <motion.div
      animate={{ y: show ? 0 : -100, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="fixed top-14 sm:top-16 md:top-20 w-full bg-gradient-to-r from-emerald-50 to-green-50 z-40 shadow-sm border-b border-emerald-100"
    >
      <div className="container mx-auto px-2 sm:px-3 md:px-4 py-2 sm:py-3">
        <div className="flex flex-wrap gap-1.5 sm:gap-2 md:gap-4 justify-center">
          {NAV_GROUPS.map((group, index) => (
            <div key={group.name} className="relative">
              <button
                type="button"
                className={linkClass}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              >
                <span className="hidden sm:inline">{group.icon}</span>
                <span>{group.name}</span>
                <ChevronDown className={openIndex === index ? "rotate-180" : ""} />
              </button>
              {openIndex === index && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute left-0 mt-1 w-56 sm:w-64 bg-white border border-emerald-100 rounded-lg shadow-lg z-50 max-h-[60vh] overflow-y-auto overscroll-contain"
                >
                  <div className="py-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.label}
                        href={buildFilterHref(item.filter)}
                        className="block px-3 sm:px-4 py-2 text-xs sm:text-sm text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 hover:text-emerald-900 transition-colors touch-manipulation"
                        onClick={() => setOpenIndex(null)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          ))}

          <Link href="/shop" prefetch={false} className={linkClass}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Buy Again
          </Link>

          <Link href={buildFilterHref({ type: "tag", value: "gift" })} prefetch={false} className={linkClass}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            <span className="hidden sm:inline">Gift Options</span>
            <span className="sm:hidden">Gifts</span>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
