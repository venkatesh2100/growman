"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { searchProducts } from "../../lib/api";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import { ShoppingBag, Mic, ScanSearch } from "lucide-react";
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
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Categories" },
  { href: "/about", label: "About" },
];

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

const CloseIcon = () => (
  <Icon className="h-6 w-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </Icon>
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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="absolute top-full left-0 right-0 z-50 mt-2 max-h-[60vh] overflow-y-auto overscroll-contain rounded-2xl border border-emerald-100/80 bg-white shadow-[0_12px_40px_rgba(6,78,59,0.12)] sm:max-h-96"
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
            Search catalog
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
                  alt={product.name}
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
                {product.currency} {Number(product.price || 0).toFixed(0)}
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
            View all results
          </button>
        </div>
      )}
    </motion.div>
  </AnimatePresence>
);

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showCategories, setShowCategories] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
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
  const navbarRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const voiceResultRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  // Cart store
  const totalQuantity = useCartStore((state) => state.getTotalQuantity());

  // Auth store
  const isLoggedIn = useAuthStore((state) => state.isAuthenticated);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const checkAuth = useAuthStore((state) => state.checkAuth);

  // Check auth status on mount and when pathname changes (after navigation)
  useEffect(() => {
    checkAuth();
  }, [checkAuth, pathname]);

  // Close account menu on outside click
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

  useEffect(() => {
    if (!isMounted) return;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setShowCategories(false);
      } else if (currentScrollY < lastScrollY) {
        setShowCategories(true);
      }
      setIsScrolled(currentScrollY > 50);
      setLastScrollY(currentScrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY, isMounted]);

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

  if (!isMounted) {
    return <div ref={navbarRef} />;
  }

  return (
    <div ref={navbarRef}>
      <motion.header
        className={`fixed w-full z-50 transition-all duration-300 ${
          isScrolled ? "bg-gradient-to-r from-green-100 to-emerald-50 shadow-lg py-1.5 sm:py-2" : "bg-gradient-to-b from-green-200 to-emerald-100 backdrop-blur-sm py-2 sm:py-3"
        }`}
      >
        <div className="container mx-auto px-3 sm:px-4 flex justify-between items-center">
          <Link href="/" className="flex items-center sm:gap-1 group touch-manipulation">
            <Image
              src="/logo.png"
              alt="Growman"
              width={56}
              height={56}
              priority
              className="h-11 w-11 sm:h-14 sm:w-14 object-contain"
            />
            <h1 className="font-space text-sm sm:text-3xl md:text-[2rem] font-bold tracking-tight text-green-800 group-hover:text-emerald-700 transition-colors">
              Growman
            </h1>
          </Link>

          <nav className="hidden md:flex space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={link.href === "/about" ? false : undefined}
                className={`px-3 sm:px-4 py-2 font-medium rounded-lg transition-colors text-sm sm:text-base ${
                  pathname === link.href ? "text-emerald-700 bg-emerald-50 font-semibold" : "text-green-800 hover:text-emerald-600 hover:bg-emerald-50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>


          <div className="flex items-center space-x-1.5 sm:space-x-2 md:space-x-3">
            <div ref={searchContainerRef} className="hidden md:block relative">
              <form onSubmit={handleSearchSubmit} className="flex items-center bg-emerald-50 rounded-full pl-3 sm:pl-4 pr-2 py-1 transition-all duration-300 shadow-inner">
                <input
                  type="text"
                  placeholder="Search plants, seeds, tools..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
                  className="bg-transparent outline-none w-48 sm:w-58 text-sm sm:text-base text-green-800 placeholder-emerald-600/70"
                />
                <button
                  type="button"
                  onClick={handleVoicePress}
                  className={`p-1.5 sm:p-2 rounded-full transition-colors touch-manipulation ${listening ? "text-rose-600 bg-rose-50" : "text-emerald-700 hover:text-emerald-900"}`}
                  aria-label={listening ? "Stop voice search" : "Start voice search"}
                >
                  <Mic className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleScanPress}
                  className="p-1.5 sm:p-2 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation"
                  aria-label="Open AI plant scan"
                >
                  <ScanSearch className={`h-4 w-4 sm:h-5 sm:w-5 ${scanning ? "animate-pulse" : ""}`} />
                </button>
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="p-1.5 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation active:scale-95"
                    aria-label="Clear search"
                  >
                    {/* <CloseIcon /> */}
                  </button>
                )}
                <button type="submit" className="p-1.5 sm:p-2 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation">
                  {isSearching ? (
                    <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <SearchIcon />
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

            <button className="md:hidden p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full transition-colors touch-manipulation active:scale-95" onClick={() => setIsSearchOpen(!isSearchOpen)} aria-label="Search">
              <SearchIcon />
            </button>

            {/* Cart Icon with Badge */}
            <Link
              href="/cart"
              className="p-1.5 sm:p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full transition-colors relative touch-manipulation active:scale-95"
              aria-label="Cart"
              data-cart-icon
            >
              <CartIcon />
              {totalQuantity > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 bg-red-500 text-white text-[10px] sm:text-xs font-bold rounded-full h-4 w-4 sm:h-5 sm:w-5 flex items-center justify-center shadow-lg"
                >
                  {totalQuantity > 99 ? '99+' : totalQuantity}
                </motion.span>
              )}
            </Link>

            {/* Account Menu */}
            <div ref={accountMenuRef} className="relative">
              <button
                onMouseEnter={() => setShowAccountMenu(true)}
                onMouseLeave={() => setShowAccountMenu(false)}
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className="p-1.5 sm:p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full transition-colors touch-manipulation active:scale-95"
                aria-label="Account"
              >
                <UserIcon />
              </button>

              <AccountMenu
                show={showAccountMenu}
                isLoggedIn={isLoggedIn}
                onLogout={handleLogout}
                onNavigate={() => setShowAccountMenu(false)}
                onMouseEnter={() => setShowAccountMenu(true)}
                onMouseLeave={() => setShowAccountMenu(false)}
              />
            </div>

            <button className="md:hidden p-1.5 sm:p-2 text-emerald-700 hover:bg-emerald-50 rounded-lg ml-1 sm:ml-2 touch-manipulation active:scale-95" onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label={isMenuOpen ? "Close menu" : "Open menu"}>
              {isMenuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {isSearchOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden container mx-auto px-3 sm:px-4 py-2 sm:py-3">
            <div ref={searchContainerRef} className="relative">
              <form onSubmit={handleSearchSubmit} className="flex items-center rounded-2xl px-2.5 py-2 border border-emerald-100 bg-white shadow-inner">
                <span className="p-1 text-emerald-700">
                  <SearchIcon />
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search catalog or ask Dootha..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
                  className="bg-transparent outline-none w-full text-sm sm:text-base text-green-800 placeholder-gray-400 px-1.5"
                />
                <button
                  type="button"
                  onClick={handleVoicePress}
                  className={`mr-1 p-1 rounded-full transition-colors touch-manipulation ${listening ? "text-rose-600 bg-rose-50" : "text-emerald-700 hover:text-emerald-900"}`}
                  aria-label={listening ? "Stop voice search" : "Start voice search"}
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleScanPress}
                  className="mr-1 p-1 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation"
                  aria-label="Open AI plant scan"
                >
                  <ScanSearch className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} />
                </button>
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    className="p-1.5 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation active:scale-95"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    <CloseIcon />
                  </button>
                )}
                <button type="button" className="p-1 text-emerald-700 hover:text-emerald-900 rounded-full transition-colors touch-manipulation active:scale-95" onClick={() => { setIsSearchOpen(false); setShowSearchResults(false); }}>
                  <CloseIcon />
                </button>
              </form>
              <button
                type="button"
                onClick={handleCatalogSearch}
                disabled={!searchQuery.trim()}
                className={`mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-colors ${
                  searchQuery.trim() ? "bg-emerald-700 text-white" : "bg-gray-200 text-gray-400"
                }`}
                aria-label="Search shop"
              >
                <ShoppingBag className="h-4 w-4" />
                Search shop
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
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden bg-white border-t border-emerald-100 max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain">
              <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex flex-col space-y-1 sm:space-y-2">
                {navLinks.map((link) => (
                  <Link key={link.href} href={link.href} prefetch={link.href === "/about" ? false : undefined} className="px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base text-emerald-800 font-medium hover:text-emerald-600 active:text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 rounded-lg transition-colors touch-manipulation">
                    {link.label}
                  </Link>
                ))}
                <Link href="/contact" prefetch={false} className="px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base text-emerald-800 font-medium hover:text-emerald-600 active:text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 rounded-lg transition-colors touch-manipulation">Contact</Link>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 pt-2 pb-2 sm:pb-3">
                  <Link href="/account" prefetch={false} className="flex items-center justify-center text-emerald-800 px-4 py-2.5 font-medium hover:bg-emerald-50 active:bg-emerald-100 rounded-lg touch-manipulation">
                    <span className="h-4 w-4 sm:h-5 sm:w-5 mr-2"><UserIcon /></span>Account
                  </Link>
                  <Link href="/cart" className="relative flex items-center justify-center text-emerald-800 px-4 py-2.5 font-medium hover:bg-emerald-50 active:bg-emerald-100 rounded-lg touch-manipulation">
                    <span className="h-4 w-4 sm:h-5 sm:w-5 mr-2"><CartIcon /></span>Cart
                    {totalQuantity > 0 && (
                      <span className="ml-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                        {totalQuantity > 99 ? '99+' : totalQuantity}
                      </span>
                    )}
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      <CategoryFilterBar show={showCategories} />
      
      <div className="h-20 sm:h-24 md:h-28 lg:h-32"></div>
    </div>
  );
}
