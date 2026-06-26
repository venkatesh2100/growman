"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FaLeaf } from "react-icons/fa";
import { searchProducts } from "../../lib/api";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import { LogOut, Package, Settings, ShoppingBag, LogIn, Heart, Mic, ScanSearch } from "lucide-react";
import CategoryFilterBar from "./CategoryFilterBar";

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

const SearchResults = ({ results, onProductClick, onClose }: { results: Product[]; onProductClick: (slug: string) => void; onClose?: () => void }) => (
  <AnimatePresence>
    {results.length > 0 && (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-emerald-100 max-h-[60vh] sm:max-h-96 overflow-y-auto z-50 overscroll-contain"
      >
        <div className="p-2">
          {results.map((product) => (
            <button
              key={product.id}
              onClick={() => {
                onProductClick(product.slug);
                onClose?.();
              }}
              className="w-full flex items-center space-x-2 sm:space-x-3 p-2 sm:p-3 hover:bg-emerald-50 active:bg-emerald-100 rounded-lg transition-colors text-left touch-manipulation"
            >
              {product.imageUrl && (
                <Image
                  src={product.imageUrl.trim()}
                  alt={product.name}
                  width={48}
                  height={48}
                  className="w-10 h-10 sm:w-12 sm:h-12 object-cover rounded shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-green-900 truncate">{product.name}</p>
                {product.category && <p className="text-[10px] sm:text-xs text-emerald-600 truncate">{product.category.name}</p>}
                <p className="text-xs sm:text-sm font-semibold text-emerald-700 mt-0.5 sm:mt-1">{product.currency} {product.price.toFixed(2)}</p>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    )}
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
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    setIsSearching(true);
    try {
      const response = await searchProducts(query);
      // Extract products array from paginated response
      const products = Array.isArray(response.data) ? response.data : [];
      setSearchResults(products);
      setShowSearchResults(products.length > 0);
    } catch (error) {
      console.error("Error searching products:", error);
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchQuery.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => performSearch(searchQuery), 300);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
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
    return (
      <div ref={navbarRef}>
        {/* <header className="fixed w-full z-50 bg-gradient-to-b from-green-200 to-emerald-100 backdrop-blur-sm py-2 sm:py-3">
          <div className="container mx-auto px-4 flex justify-between items-center">
            <Link href="/" className="flex items-center space-x-2 group">
              <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                <FaLeaf className="w-8 h-8 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold text-green-800">Growman</h1>
            </Link>
            <nav className="hidden md:flex space-x-1">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="px-4 py-2 font-medium rounded-lg text-green-800 hover:text-emerald-600 hover:bg-emerald-50">
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center space-x-3">
              <div className="hidden md:flex items-center bg-emerald-50 rounded-full pl-4 pr-2 py-1 shadow-inner">
                <input type="text" placeholder="Search plants, seeds, tools..." disabled className="bg-transparent outline-none w-58 text-green-800 placeholder-emerald-600/70" />
                <button className="p-2 text-emerald-700 hover:text-emerald-900 rounded-full" disabled><SearchIcon /></button>
              </div>
              <button className="md:hidden p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full" aria-label="Search"><SearchIcon /></button>
              <Link href="/cart" className="p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full relative" aria-label="Cart" data-cart-icon>
                <CartIcon />
                {isMounted && totalQuantity > 0 && (
                  <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {totalQuantity > 99 ? '99+' : totalQuantity}
                  </span>
                )}
              </Link>
              {isLoggedIn ? (
                <Link href="/account" className="p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full" aria-label="Account"><UserIcon /></Link>
              ) : (
                <Link href="/login" className="p-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-full" aria-label="Login"><UserIcon /></Link>
              )}
              <button className="md:hidden p-2 text-emerald-700 hover:bg-emerald-50 rounded-lg ml-2" aria-label="Open menu"><MenuIcon /></button>
            </div>
          </div>
        </header>
        <div className="fixed top-16 md:top-20 w-full bg-gradient-to-r from-emerald-50 to-green-50 z-40 shadow-sm border-b border-emerald-100">
          <div className="container mx-auto px-4 py-3">
            <div className="flex flex-wrap gap-2 md:gap-4 justify-center">
              {mainCategories.map((category, index) => (
                <div key={index} className="group relative">
                  <button className="flex items-center px-3 py-1.5 text-emerald-800 font-medium hover:text-emerald-700 hover:bg-white rounded-lg whitespace-nowrap border border-emerald-200 shadow-sm">
                    {category.icon}
                    {category.name}
                    <ChevronDown />
                  </button>
                </div>
              ))}
              <Link href="/buy-again" prefetch={false} className="flex items-center px-3 py-1.5 text-emerald-800 font-medium hover:text-emerald-700 hover:bg-white rounded-lg whitespace-nowrap border border-emerald-200 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Buy Again
              </Link>
              <Link href="/gift-options" prefetch={false} className="flex items-center px-3 py-1.5 text-emerald-800 font-medium hover:text-emerald-700 hover:bg-white rounded-lg whitespace-nowrap border border-emerald-200 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
                Gift Options
              </Link>
            </div>
          </div>
        </div>
        <div className="h-28 md:h-32"></div> */}
      </div>
    );
  }

  return (
    <div ref={navbarRef}>
      <motion.header
        className={`fixed w-full z-50 transition-all duration-300 ${
          isScrolled ? "bg-gradient-to-r from-green-100 to-emerald-50 shadow-lg py-1.5 sm:py-2" : "bg-gradient-to-b from-green-200 to-emerald-100 backdrop-blur-sm py-2 sm:py-3"
        }`}
      >
        <div className="container mx-auto px-3 sm:px-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-1.5 sm:space-x-2 group touch-manipulation">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center group-hover:from-green-700 group-hover:to-emerald-600">
              {/* <Image src="/logo.png" width={120} height={120} alt="logo" /> */}
              <FaLeaf className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-400" />
            </div>
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-green-800 group-hover:text-emerald-700 transition-colors">Growman</h1>
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
              {showSearchResults && <SearchResults results={searchResults} onProductClick={handleProductClick} />}
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

              {/* Account Dropdown Menu */}
              <AnimatePresence>
                {showAccountMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    onMouseEnter={() => setShowAccountMenu(true)}
                    onMouseLeave={() => setShowAccountMenu(false)}
                    className="absolute right-0 mt-2 w-44 sm:w-48 bg-white rounded-lg shadow-xl border border-emerald-100 py-2 z-50"
                  >
                    {isLoggedIn ? (
                      <>
                        <Link
                          href="/orders"
                          prefetch={false}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Package className="w-4 h-4 mr-3 text-emerald-600" />
                          Orders
                        </Link>
                        <Link
                          href="/cart"
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <ShoppingBag className="w-4 h-4 mr-3 text-emerald-600" />
                          My Cart
                        </Link>
                        <Link
                          href="/wishlist"
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Heart className="w-4 h-4 mr-3 text-emerald-600" />
                          Wishlist
                        </Link>
                        <Link
                          href="/account"
                          prefetch={false}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Settings className="w-4 h-4 mr-3 text-emerald-600" />
                          Profile / Settings
                        </Link>
                        <div className="border-t border-gray-200 my-1"></div>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4 mr-3" />
                          Logout
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          href="/login"
                          prefetch={false}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Package className="w-4 h-4 mr-3 text-emerald-600" />
                          Orders
                        </Link>
                        <Link
                          href="/cart"
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <ShoppingBag className="w-4 h-4 mr-3 text-emerald-600" />
                          My Cart
                        </Link>
                        <Link
                          href="/login?redirect=/wishlist"
                          prefetch={false}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Heart className="w-4 h-4 mr-3 text-emerald-600" />
                          Wishlist
                        </Link>
                        <Link
                          href="/login"
                          prefetch={false}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <Settings className="w-4 h-4 mr-3 text-emerald-600" />
                          Profile / Settings
                        </Link>
                        <div className="border-t border-gray-200 my-1"></div>
                        <Link
                          href="/login"
                          prefetch={false}
                          className="w-full flex items-center px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors"
                          onClick={() => setShowAccountMenu(false)}
                        >
                          <LogIn className="w-4 h-4 mr-3" />
                          Login / Signup
                        </Link>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
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
              {showSearchResults && <SearchResults results={searchResults} onProductClick={handleProductClick} onClose={() => setIsSearchOpen(false)} />}
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
