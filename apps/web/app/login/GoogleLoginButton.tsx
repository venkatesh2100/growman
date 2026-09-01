"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "../../lib/toast";
import { useGoogleLogin } from "@react-oauth/google";

export default function GoogleLoginButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const setToken = useAuthStore((state) => state.setToken);

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        const res = await apiFetch("/auth/google", {
          method: "POST",
          body: JSON.stringify({ token: tokenResponse.access_token }),
        });

        if (!res.ok) {
          toast("No account found with Google. Please sign up first.", "error");
          router.push("/signup");
          return;
        }

        const data = await res.json();
        setToken(data.token);
        toast("Welcome back!", "success");
        router.push("/");
      } catch (error) {
        console.error("Google login error:", error);
        toast("An error occurred. Please try again.", "error");
      } finally {
        setLoading(false);
      }
    },
    onError: () => {
      toast("Google authentication failed. Please try again.", "error");
    },
  });

  return (
    <button
      type="button"
      onClick={() => googleLogin()}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          Signing in...
        </>
      ) : (
        <>
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </>
      )}
    </button>
  );
}
