"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Gift,
  House,
  Package,
  RotateCcw,
  Sparkles,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import { buildFilterHref, type ShopFilter } from "../../lib/shopFilters";

type NavItem = { label: string; href: string; icon?: LucideIcon };

const tag = (value: string) => buildFilterHref({ type: "tag", value } satisfies ShopFilter);
const category = (value: string) =>
  buildFilterHref({ type: "category", value } satisfies ShopFilter);

const NAV_GROUPS: Array<{ name: string; icon: LucideIcon; items: NavItem[] }> = [
  {
    name: "Plants",
    icon: Sprout,
    items: [
      { label: "All plants", href: "/shop" },
      { label: "Indoor plants", href: category("indoor-plants") },
      { label: "Outdoor plants", href: category("outdoor-plants") },
      { label: "Ornamental plants", href: category("ornamental-plants") },
      { label: "Avenue trees", href: category("avenue") },
      { label: "Fruit plants", href: category("fruit-plants") },
      { label: "Medicinal plants", href: category("medicinal") },
    ],
  },
  {
    name: "By need",
    icon: Sparkles,
    items: [
      { label: "Air-purifying", href: tag("air purify") },
      { label: "Low light", href: tag("low-light") },
      { label: "Easy care", href: tag("stress-free") },
      { label: "Flowering", href: tag("flowering") },
      { label: "Bonsai", href: tag("bonsai") },
      { label: "Topiary", href: tag("Topiary") },
    ],
  },
  {
    name: "By space",
    icon: House,
    items: [
      { label: "Balcony", href: tag("balcony") },
      { label: "Terrace", href: tag("terrace") },
      { label: "Office and desk", href: tag("office") },
      { label: "Decorative", href: tag("Decorational") },
    ],
  },
  {
    name: "Gifts",
    icon: Gift,
    items: [
      { label: "Gift plants", href: tag("gift") },
      { label: "Good luck plants", href: tag("good-luck") },
      { label: "Corporate gifting", href: "/gifting" },
    ],
  },
];

const DIRECT_LINKS: NavItem[] = [
  { label: "Bulk orders", href: "/bulk", icon: Package },
  { label: "Buy again", href: "/orders", icon: RotateCcw },
];

/** The flat row shown on phones, where dropdowns inside a scroller would be clipped. */
const MOBILE_CHIPS: NavItem[] = [
  { label: "All plants", href: "/shop" },
  { label: "Indoor", href: category("indoor-plants") },
  { label: "Outdoor", href: category("outdoor-plants") },
  { label: "Air-purifying", href: tag("air purify") },
  { label: "Low light", href: tag("low-light") },
  { label: "Easy care", href: tag("stress-free") },
  { label: "Balcony", href: tag("balcony") },
  { label: "Flowering", href: tag("flowering") },
  { label: "Gift plants", href: tag("gift") },
  { label: "Bonsai", href: tag("bonsai") },
  { label: "Medicinal", href: category("medicinal") },
  { label: "Bulk orders", href: "/bulk" },
];

const chip =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1 text-[13px] font-medium whitespace-nowrap text-emerald-800 shadow-sm transition-colors hover:bg-white hover:text-emerald-700 active:bg-emerald-50 touch-manipulation md:text-sm";

export default function CategoryFilterBar({ show }: { show: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const close = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenIndex(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openIndex]);

  useEffect(() => {
    if (!show) setOpenIndex(null);
  }, [show]);

  return (
    <motion.nav
      aria-label="Shop by category"
      animate={{ y: show ? 0 : -48, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="fixed inset-x-0 top-16 z-40 h-11 border-b border-emerald-100 bg-linear-to-r from-emerald-50 to-green-50 shadow-sm md:top-[72px]"
    >
      <div
        ref={barRef}
        className="mx-auto hidden h-full max-w-7xl items-center justify-center gap-2 px-4 md:flex lg:gap-3 lg:px-6"
      >
        {NAV_GROUPS.map((group, index) => (
          <div key={group.name} className="relative">
            <button
              type="button"
              className={`${chip} ${openIndex === index ? "bg-white text-emerald-700" : ""}`}
              aria-expanded={openIndex === index}
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
            >
              <group.icon className="h-4 w-4 text-green-600" aria-hidden="true" />
              {group.name}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openIndex === index ? "rotate-180" : ""}`}
              />
            </button>
            {openIndex === index && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full left-0 z-50 mt-1 max-h-[60vh] w-56 overflow-y-auto overscroll-contain rounded-lg border border-emerald-100 bg-white py-2 shadow-lg sm:w-64"
              >
                {group.items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="block px-4 py-2 text-sm text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-900 active:bg-emerald-100 touch-manipulation"
                    onClick={() => setOpenIndex(null)}
                  >
                    {item.label}
                  </Link>
                ))}
              </motion.div>
            )}
          </div>
        ))}
        {DIRECT_LINKS.map((item) => (
          <Link key={item.href} href={item.href} prefetch={false} className={chip}>
            {item.icon ? <item.icon className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : null}
            {item.label}
          </Link>
        ))}
      </div>

      <div className="scrollbar-hide flex h-full items-center gap-1.5 overflow-x-auto px-3 md:hidden">
        {MOBILE_CHIPS.map((item) => (
          <Link key={item.label} href={item.href} prefetch={false} className={chip}>
            {item.label}
          </Link>
        ))}
      </div>
    </motion.nav>
  );
}
