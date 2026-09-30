"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Lock, Mic, ScanSearch, ShoppingBag } from "lucide-react";
import { searchProducts } from "../../lib/api";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import CategoryFilterBar from "./CategoryFilterBar";
import AccountMenu from "./AccountMenu";

interface Product {
  id: number;
  name: string;
  slug: string;
  price: number;
  currency: string;
  imageUrl?: string;
  category?: { name: string };
}

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const navLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Categories" },
  { href: "/gifting", label: "Gifting" },
  { href: "/bulk", label: "Bulk orders" },
  { href: "/about", label: "About" },
];

const mobileExtraLinks = [
  { href: "/blog", label: "Plant care guides" },
  { href: "/help-center", label: "Help Center" },
];

const iconButton =
  "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-900 active:scale-95 touch-manipulation";

const Icon = ({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    {children}
  </svg>
);

const SearchIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </Icon>
);

const CartIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
  </Icon>
);

const UserIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </Icon>
);

const MenuIcon = () => (
  <Icon className="h-6 w-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

const CloseIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <Icon className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </Icon>
);

const Wordmark = () => (
  <Link href="/" className="group flex shrink-0 items-center gap-1 touch-manipulation" aria-label="Growman home">
    <Image src="/logo.png" alt="" width={56} height={56} priority className="h-11 w-11 object-contain md:h-12 md:w-12" />
    {/* Not an <h1>: each page owns its own H1. */}
    <span className="font-space text-2xl font-bold tracking-tight text-green-800 transition-colors group-hover:text-emerald-700 sm:text-3xl md:text-[2rem]">
      Growman
    </span>
  </Link>
);

const SearchResults = ({
  results,
  loading,
  query,
  onProductClick,
  onViewAll,
  onClose,
}: {
  results: Product[];
  loading: boolean;
  query: string;
  onProductClick: (slug: string) => void;
  onViewAll: () => void;
  onClose?: () => void;
}) => (
  <AnimatePresence>
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[60vh] overflow-y-auto overscroll-contain rounded-2xl border border-emerald-100/80 bg-white shadow-[0_12px_40px_rgba(6,78,59,0.12)] sm:max-h-96"
    >
      {loading && results.length === 0 ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <div className="h-11 w-11 shrink-0 rounded-lg bg-emerald-50" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-[75%] rounded bg-slate-100" />
                <div className="h-3 w-[33%] rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-gray-500">No matches for “{query}”</p>
          <button
            type="button"
            onClick={() => {
              onViewAll();
              onClose?.();
            }}
            className="mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            Search the full catalog
          </button>
        </div>
      ) : (
        <div className="p-2">
          {results.slice(0, 8).map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => {
                onProductClick(product.slug);
                onClose?.();
              }}
              className="flex w-full touch-manipulation items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-emerald-50 active:bg-emerald-100 sm:p-2.5"
            >
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl.trim()}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-lg bg-emerald-50" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-green-900">{product.name}</p>
                {product.category ? (
                  <p className="truncate text-xs text-gray-500">{product.category.name}</p>
                ) : null}
              </div>
              <p className="shrink-0 text-sm font-semibold text-emerald-700">
                ₹{Number(product.price || 0).toFixed(0)}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onViewAll();
              onClose?.();
            }}
            className="mt-1 w-full rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            See all results
          </button>
        </div>
      )}
    </motion.div>
  </AnimatePresence>
);

/** Header shown on checkout: brand, reassurance and a way back, nothing else to click. */
function CheckoutHeader() {
  return (
    <div>
      <header className="fixed inset-x-0 top-0 z-50 bg-linear-to-b from-green-200 to-emerald-100 shadow-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 md:h-[72px] lg:px-8">
          <Wordmark />
          <p className="hidden items-center gap-1.5 text-sm font-medium text-green-800 sm:flex">
            <Lock className="h-4 w-4 text-emerald-700" />
            Secure checkout
          </p>
          <Link
            href="/cart"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 hover:text-emerald-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to cart
          </Link>
        </div>
      </header>
      <div className="h-16 md:h-[72px]" aria-hidden="true" />
    </div>
  );
}

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showCategories, setShowCategories] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [listening, setListening] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const voiceResultRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const lastScrollYRef = useRef(0);

  const totalQuantity = useCartStore((state) => state.getTotalQuantity());

  const isLoggedIn = useAuthStore((state) => state.isAuthenticated);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const checkAuth = useAuthStore((state) => state.checkAuth);

  const isCheckout = pathname === "/checkout" || pathname?.startsWith("/checkout/");

  // Check auth status on mount and when pathname changes (after navigation)
  useEffect(() => {
    checkAuth();
  }, [checkAuth, pathname]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    clearAuth();
    setShowAccountMenu(false);
    router.push("/");
  };

  useEffect(() => setIsMounted(true), []);

  // The last position lives in a ref so scrolling only re-renders the header
  // when one of the two visible states actually flips.
  useEffect(() => {
    if (!isMounted) return;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const last = lastScrollYRef.current;
      if (currentScrollY > last && currentScrollY > 120) {
        setShowCategories(false);
      } else if (currentScrollY < last) {
        setShowCategories(true);
      }
      setIsScrolled(currentScrollY > 8);
      lastScrollYRef.current = currentScrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isMounted]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isSearchOpen && searchRef.current) searchRef.current.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) setShowSearchResults(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const performSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      setIsSearching(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setShowSearchResults(true);
    try {
      const response = await searchProducts(q, 1, 8, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(Array.isArray(response.data) ? response.data : []);
      setShowSearchResults(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Error searching products:", error);
      setSearchResults([]);
      setShowSearchResults(true);
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchQuery.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => performSearch(searchQuery), 200);
    } else {
      searchAbortRef.current?.abort();
      setSearchResults([]);
      setShowSearchResults(false);
      setIsSearching(false);
    }
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, performSearch]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value);
  const handleCatalogSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
    setShowSearchResults(false);
    setSearchQuery("");
    setIsSearchOpen(false);
  }, [router, searchQuery]);
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCatalogSearch();
  };
  const handleProductClick = (slug: string) => {
    router.push(`/product/${slug}`);
    setShowSearchResults(false);
    setSearchQuery("");
  };

  const handleScanPress = () => {
    setScanning(true);
    window.dispatchEvent(new Event("growman:open-chatbot"));
    setTimeout(() => setScanning(false), 350);
  };

  const handleVoicePress = useCallback(() => {
    if (typeof window === "undefined") return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const RecognitionCtor = (
      window as typeof window & {
        SpeechRecognition?: new () => BrowserSpeechRecognition;
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      }
    ).SpeechRecognition || (
      window as typeof window & {
        SpeechRecognition?: new () => BrowserSpeechRecognition;
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      }
    ).webkitSpeechRecognition;

    if (!RecognitionCtor) return;

    const recognition = new RecognitionCtor();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        voiceResultRef.current = transcript;
        setSearchQuery(transcript);
        setShowSearchResults(transcript.length >= 2);
      }
    };

    recognition.onerror = () => {
      setListening(false);
      voiceResultRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
    };

    setListening(true);
    recognition.start();
  }, [listening]);

  // The header is server-rendered so it paints with the page and its spacer
  // reserves space up front. Only values read from persisted client stores
  // wait for mount, to keep the server and first client render identical.
  const cartCount = isMounted ? totalQuantity : 0;

  if (isCheckout) return <CheckoutHeader />;

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <div>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "bg-linear-to-r from-green-100 to-emerald-50 shadow-lg"
            : "bg-linear-to-b from-green-200 to-emerald-100 backdrop-blur-sm"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-4 md:h-[72px] lg:px-6">
          <Wordmark />

          <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={link.href === "/about" ? false : undefined}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-[15px] font-medium transition-colors ${
                  isActive(link.href)
                    ? "bg-emerald-50 font-semibold text-emerald-700"
                    : "text-green-800 hover:bg-emerald-50 hover:text-emerald-600"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-0.5 sm:gap-1">
            <div ref={searchContainerRef} className="relative mr-1 hidden md:block">
              <form
                onSubmit={handleSearchSubmit}
                role="search"
                className="flex items-center rounded-full bg-emerald-50 py-1 pr-1.5 pl-4 shadow-inner transition-all duration-300"
              >
                <input
                  type="search"
                  placeholder="Search plants"
                  aria-label="Search plants"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
                  className="w-44 bg-transparent text-sm text-green-800 outline-none placeholder:text-emerald-600/70 xl:w-56"
                />
                <button
                  type="button"
                  onClick={handleVoicePress}
                  className={`rounded-full p-1.5 transition-colors touch-manipulation ${listening ? "bg-rose-50 text-rose-600" : "text-emerald-700 hover:text-emerald-900"}`}
                  aria-label={listening ? "Stop voice search" : "Search by voice"}
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleScanPress}
                  className="rounded-full p-1.5 text-emerald-700 transition-colors hover:text-emerald-900 touch-manipulation"
                  aria-label="Identify a plant from a photo"
                >
                  <ScanSearch className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} />
                </button>
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="rounded-full p-1.5 text-emerald-700 transition-colors hover:text-emerald-900 touch-manipulation"
                    aria-label="Clear search"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="submit"
                  aria-label="Search"
                  className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-emerald-700 transition-colors hover:text-emerald-900 touch-manipulation"
                >
                  {isSearching ? (
                    <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                </button>
              </form>
              {showSearchResults && (
                <SearchResults
                  results={searchResults}
                  loading={isSearching}
                  query={searchQuery.trim()}
                  onProductClick={handleProductClick}
                  onViewAll={handleCatalogSearch}
                />
              )}
            </div>

            <button className={`${iconButton} md:hidden`} onClick={() => setIsSearchOpen(!isSearchOpen)} aria-label="Search">
              <SearchIcon />
            </button>

            <div ref={accountMenuRef} className="relative">
              <button
                onMouseEnter={() => setShowAccountMenu(true)}
                onMouseLeave={() => setShowAccountMenu(false)}
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className={iconButton}
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={showAccountMenu}
              >
                <UserIcon />
              </button>

              <AccountMenu
                show={showAccountMenu}
                isLoggedIn={isMounted && isLoggedIn}
                onLogout={handleLogout}
                onNavigate={() => setShowAccountMenu(false)}
                onMouseEnter={() => setShowAccountMenu(true)}
                onMouseLeave={() => setShowAccountMenu(false)}
              />
            </div>

            <Link
              href="/cart"
              className={iconButton}
              aria-label={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"}
              data-cart-icon
            >
              <CartIcon />
              {cartCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-0 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-lg sm:h-5 sm:min-w-5 sm:text-xs"
                >
                  {cartCount > 99 ? "99+" : cartCount}
                </motion.span>
              )}
            </Link>

            <button
              className={`${iconButton} lg:hidden`}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMenuOpen}
            >
              {isMenuOpen ? <CloseIcon className="h-6 w-6" /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {isSearchOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 sm:py-3 md:hidden"
          >
            <div ref={searchContainerRef} className="relative">
              <form
                onSubmit={handleSearchSubmit}
                role="search"
                className="flex items-center rounded-2xl border border-emerald-100 bg-white px-2.5 py-2 shadow-inner"
              >
                <span className="p-1 text-emerald-700">
                  <SearchIcon />
                </span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search plants"
                  aria-label="Search plants"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
                  className="w-full bg-transparent px-1.5 text-base text-green-800 outline-none placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={handleVoicePress}
                  className={`mr-1 rounded-full p-1 transition-colors touch-manipulation ${listening ? "bg-rose-50 text-rose-600" : "text-emerald-700 hover:text-emerald-900"}`}
                  aria-label={listening ? "Stop voice search" : "Search by voice"}
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleScanPress}
                  className="mr-1 rounded-full p-1 text-emerald-700 transition-colors hover:text-emerald-900 touch-manipulation"
                  aria-label="Identify a plant from a photo"
                >
                  <ScanSearch className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} />
                </button>
                <button
                  type="button"
                  aria-label="Close search"
                  className="rounded-full p-1 text-emerald-700 transition-colors hover:text-emerald-900 active:scale-95 touch-manipulation"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setShowSearchResults(false);
                  }}
                >
                  <CloseIcon />
                </button>
              </form>
              <button
                type="button"
                onClick={handleCatalogSearch}
                disabled={!searchQuery.trim()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3 text-sm font-semibold text-white transition-colors disabled:bg-gray-200 disabled:text-gray-400"
              >
                <ShoppingBag className="h-4 w-4" />
                Search the shop
              </button>
              {showSearchResults && (
                <SearchResults
                  results={searchResults}
                  loading={isSearching}
                  query={searchQuery.trim()}
                  onProductClick={handleProductClick}
                  onViewAll={handleCatalogSearch}
                  onClose={() => setIsSearchOpen(false)}
                />
              )}
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {isMenuOpen && (
            <motion.nav
              aria-label="Mobile"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-emerald-100 bg-white lg:hidden"
            >
              <div className="mx-auto flex max-w-7xl flex-col space-y-1 px-3 py-3 sm:px-4">
                {[...navLinks, ...mobileExtraLinks].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    prefetch={false}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={`rounded-lg px-3 py-3 text-base font-medium transition-colors touch-manipulation ${
                      isActive(link.href)
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-emerald-800 hover:bg-emerald-50 hover:text-emerald-600 active:bg-emerald-100"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-emerald-100 pt-3">
                  <Link
                    href={isMounted && isLoggedIn ? "/account" : "/login"}
                    prefetch={false}
                    className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 active:bg-emerald-100 touch-manipulation"
                  >
                    <span className="h-5 w-5">
                      <UserIcon />
                    </span>
                    {isMounted && isLoggedIn ? "Account" : "Sign in"}
                  </Link>
                  <Link
                    href="/cart"
                    className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 active:bg-emerald-100 touch-manipulation"
                  >
                    <span className="h-5 w-5">
                      <CartIcon />
                    </span>
                    Cart
                    {cartCount > 0 && (
                      <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
                        {cartCount > 99 ? "99+" : cartCount}
                      </span>
                    )}
                  </Link>
                </div>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <CategoryFilterBar show={showCategories} />

      <div className="h-[108px] md:h-[116px]" aria-hidden="true" />
    </div>
  );
}
