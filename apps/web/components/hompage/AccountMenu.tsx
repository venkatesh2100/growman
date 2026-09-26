import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, LogIn, LogOut, Package, Settings, ShoppingBag } from "lucide-react";

const menuLinkClass =
  "flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 transition-colors";

interface AccountMenuProps {
  show: boolean;
  isLoggedIn: boolean;
  onLogout: () => void;
  onNavigate: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/** The dropdown shown from the navbar's account icon, with logged-in vs guest links. */
export default function AccountMenu({
  show,
  isLoggedIn,
  onLogout,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: AccountMenuProps) {
  const links = [
    { href: isLoggedIn ? "/orders" : "/login", label: "Orders", icon: Package, prefetch: false },
    { href: "/cart", label: "My Cart", icon: ShoppingBag },
    { href: isLoggedIn ? "/wishlist" : "/login?redirect=/wishlist", label: "Wishlist", icon: Heart, prefetch: false },
    { href: isLoggedIn ? "/account" : "/login", label: "Profile / Settings", icon: Settings, prefetch: false },
  ];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className="absolute right-0 mt-2 w-44 sm:w-48 bg-white rounded-lg shadow-xl border border-emerald-100 py-2 z-50"
        >
          {links.map(({ href, label, icon: Icon, prefetch }) => (
            <Link key={label} href={href} prefetch={prefetch} className={menuLinkClass} onClick={onNavigate}>
              <Icon className="w-4 h-4 mr-3 text-emerald-600" />
              {label}
            </Link>
          ))}
          <div className="border-t border-gray-200 my-1"></div>
          {isLoggedIn ? (
            <button
              onClick={onLogout}
              className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4 mr-3" />
              Logout
            </button>
          ) : (
            <Link
              href="/login"
              prefetch={false}
              className="w-full flex items-center px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors"
              onClick={onNavigate}
            >
              <LogIn className="w-4 h-4 mr-3" />
              Login / Signup
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
