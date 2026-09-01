"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { LogIn, Mail, Lock, Loader2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { GoogleOAuthProvider } from "@react-oauth/google";
import GoogleLoginButton from "./GoogleLoginButton";
import { toast } from "../../lib/toast";
import {
  TurnstileGate,
  isTurnstileSiteConfigured,
} from "../../components/TurnstileGate";

function LoginPageContent({ googleClientId }: { googleClientId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setToken = useAuthStore((state) => state.setToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [humanOk, setHumanOk] = useState(() => !isTurnstileSiteConfigured());

  useEffect(() => {
    const emailParam = searchParams?.get("email");
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      const msg = "Enter your email and password.";
      setError(msg);
      toast(msg, "error");
      return;
    }

    if (isTurnstileSiteConfigured() && !humanOk) {
      toast("Please complete the security check (bottom-right).", "error");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!res.ok) {
        let errorMessage = "Couldn't sign you in. Try again.";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            const apiError = String(errorData.error || errorData.message || "").toLowerCase();

            if (res.status === 429) {
              errorMessage = "Too many attempts. Wait a bit and try again.";
            } else if (
              apiError.includes("account not found") ||
              apiError.includes("not found") ||
              apiError.includes("does not exist")
            ) {
              errorMessage = "No account with that email. Sign up first.";
            } else if (
              apiError.includes("invalid") ||
              apiError.includes("credential") ||
              apiError.includes("unauthorized")
            ) {
              errorMessage = "Wrong email or password.";
            } else if (res.status >= 500) {
              errorMessage = "Couldn't sign you in. Try again.";
            }
          } else if (res.status >= 500) {
            errorMessage = "Couldn't sign you in. Try again.";
          }
        } catch {
          errorMessage = "Couldn't sign you in. Try again.";
        }

        setError(errorMessage);
        toast(errorMessage, "error");
        return;
      }

      const data = await res.json();
      setToken(data.token);
      toast("Signed in.", "success");
      setSuccess(true);

      const redirect = searchParams?.get("redirect") || "/";
      setTimeout(() => {
        router.push(redirect);
      }, 800);
    } catch {
      const errorMsg = "No connection. Check your internet and try again.";
      setError(errorMsg);
      toast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8 sm:px-6 sm:py-12">
      <TurnstileGate onHumanVerified={setHumanOk} />
      <div className="mx-auto flex w-full max-w-md flex-col justify-center">
        <Link
          href="/"
          prefetch={false}
          className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-xl text-green-900 transition-colors hover:bg-emerald-50"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        <div className="mb-8">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative h-11 w-11 overflow-hidden rounded-2xl shadow-sm ring-1 ring-emerald-800/10">
              <Image src="/growman.png" alt="Growman" fill sizes="44px" className="object-cover" />
            </div>
            <span className="font-space text-lg font-semibold tracking-tight text-green-900">
              Growman
            </span>
          </div>
          <h1 className="font-space text-[28px] font-bold tracking-tight text-green-900">
            Sign in to your account
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            New here?{" "}
            <Link
              href="/signup"
              prefetch={false}
              className="font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Create an account
            </Link>
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleLogin}>
          {error ? (
            <p className="text-sm text-green-950/55">{error}</p>
          ) : null}

          {success ? (
            <p className="text-sm text-emerald-700">Signed in. Redirecting…</p>
          ) : null}

          <div className="flex items-center rounded-2xl border border-emerald-100 bg-white px-4">
            <Mail className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
            <input
              id="email"
              name="email"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              className="w-full bg-transparent py-4 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
              placeholder="Email or phone number"
            />
          </div>

          <div className="flex items-center rounded-2xl border border-emerald-100 bg-white px-4">
            <Lock className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="w-full bg-transparent py-4 pr-2 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
              placeholder="Enter your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || success || (isTurnstileSiteConfigured() && !humanOk)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-5 w-5" />
                Sign in
              </>
            )}
          </button>

          {googleClientId ? (
            <div className="pt-2">
              <div className="relative my-4 flex items-center">
                <div className="h-px flex-1 bg-emerald-100" />
                <span className="mx-3 text-sm text-gray-500">Or continue with</span>
                <div className="h-px flex-1 bg-emerald-100" />
              </div>
              <GoogleLoginButton />
            </div>
          ) : null}

          <div className="pt-2 text-center">
            <Link
              href="/forgot-password"
              prefetch={false}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function LoginPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB]">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
    </div>
  );
}

export default function LoginPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  return (
    <GoogleOAuthProvider clientId={googleClientId || "dummy"}>
      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent googleClientId={googleClientId} />
      </Suspense>
    </GoogleOAuthProvider>
  );
}
