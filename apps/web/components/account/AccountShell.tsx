"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, LogOut, Package, UserRound } from "lucide-react";
import { useAuthStore } from "../../lib/store/authStore";

const NAV = [
  { href: "/account", label: "Profile", icon: UserRound },
  { href: "/orders", label: "Orders", icon: Package },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
] as const;

type AccountShellProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Layout for the signed-in pages. Guests are sent to sign in and come back to
 * the page they asked for. The check waits for mount because the token lives
 * in localStorage, which the server render cannot see.
 */
export default function AccountShell({
  title,
  description,
  actions,
  children,
}: AccountShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname || "/account")}`);
    }
  }, [mounted, isAuthenticated, pathname, router]);

  const signOut = () => {
    clearAuth();
    router.push("/");
  };

  return (
    <main className="min-h-[60vh]">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pt-6 pb-16 sm:px-6 sm:pt-8 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-10 lg:px-8">
        <nav aria-label="Account" className="md:pt-1">
          <p className="mb-3 hidden text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase md:block">
            Your account
          </p>
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors md:rounded-xl md:border-transparent md:px-3 ${
                      active
                        ? "border-emerald-600 bg-emerald-600 text-white md:bg-emerald-50 md:text-emerald-700 md:shadow-none"
                        : "border-emerald-100 bg-white text-gray-600 hover:text-emerald-700 md:bg-transparent md:hover:bg-emerald-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0 md:mt-4 md:border-t md:border-emerald-100 md:pt-4">
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2.5 rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-green-900 md:rounded-xl md:border-transparent md:bg-transparent md:px-3 md:hover:bg-white"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-1 text-sm text-gray-600">{description}</p>
              ) : null}
            </div>
            {actions}
          </header>

          {mounted && isAuthenticated ? (
            children
          ) : (
            <div className="h-64 animate-pulse rounded-2xl border border-emerald-100 bg-white" />
          )}
        </div>
      </div>
    </main>
  );
}
