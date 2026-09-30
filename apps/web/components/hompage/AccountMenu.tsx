import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, LogIn, LogOut, Package, ShoppingBag, UserRound } from "lucide-react";

const menuLinkClass =
  "flex items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-emerald-50";

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
  const signIn = (redirect: string) => `/login?redirect=${encodeURIComponent(redirect)}`;
  const links = [
    { href: isLoggedIn ? "/account" : signIn("/account"), label: "Your account", icon: UserRound },
    { href: isLoggedIn ? "/orders" : signIn("/orders"), label: "Orders", icon: Package },
    { href: isLoggedIn ? "/wishlist" : signIn("/wishlist"), label: "Wishlist", icon: Heart },
    { href: "/cart", label: "Cart", icon: ShoppingBag },
  ];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          role="menu"
          className="absolute right-0 z-50 w-52 overflow-hidden rounded-lg border border-emerald-100 bg-white py-2 shadow-xl"
        >
          {!isLoggedIn ? (
            <div className="border-b border-gray-200 px-4 pt-1 pb-3">
              <Link
                href="/login"
                prefetch={false}
                role="menuitem"
                onClick={onNavigate}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
              <p className="mt-2 text-center text-xs text-gray-500">
                New to Growman?{" "}
                <Link
                  href="/signup"
                  prefetch={false}
                  onClick={onNavigate}
                  className="font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Create an account
                </Link>
              </p>
            </div>
          ) : null}
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={label} href={href} prefetch={false} role="menuitem" className={menuLinkClass} onClick={onNavigate}>
              <Icon className="h-4 w-4 text-emerald-600" />
              {label}
            </Link>
          ))}
          {isLoggedIn ? (
            <>
              <div className="my-1 border-t border-gray-200" />
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
