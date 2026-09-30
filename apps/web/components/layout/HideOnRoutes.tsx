"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Drops site chrome on focused flows such as checkout. Server components can
 * be passed as children; they are still rendered on the server.
 */
export default function HideOnRoutes({
  routes,
  children,
}: {
  routes: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const hidden = routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return hidden ? null : <>{children}</>;
}
