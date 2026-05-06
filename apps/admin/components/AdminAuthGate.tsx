"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { useAuthStore } from "../lib/store/authStore";

export default function AdminAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const verify = async () => {
      if (pathname === "/login") {
        setVerifying(false);
        return;
      }

      if (!token) {
        router.replace("/login");
        setVerifying(false);
        return;
      }

      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) {
          clearAuth();
          router.replace("/login");
          return;
        }

        const data = await res.json();
        const role = data?.role;
        if (role !== "admin" && role !== "superadmin") {
          clearAuth();
          router.replace("/login");
          return;
        }
      } catch {
        clearAuth();
        router.replace("/login");
        return;
      } finally {
        setVerifying(false);
      }
    };

    verify();
  }, [pathname, token, router, clearAuth]);

  if (verifying && pathname !== "/login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-600">Verifying admin session...</p>
      </div>
    );
  }

  return <>{children}</>;
}
