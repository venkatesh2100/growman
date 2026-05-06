"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { LogIn, Mail, Lock, Loader2, XCircle, CheckCircle } from "lucide-react";
import Link from "next/link";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [humanOk, setHumanOk] = useState(() => !isTurnstileSiteConfigured());

  useEffect(() => {
    // Pre-fill email from query params
    const emailParam = searchParams?.get("email");
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isTurnstileSiteConfigured() && !humanOk) {
      toast("Please complete the security check (bottom-right).", "error");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email, // Can be email or phone
          password,
        }),
      });

      if (!res.ok) {
        let errorMessage = "Login failed";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            const apiError = errorData.error || errorData.message;
            
            // Map common errors to user-friendly messages
            if (apiError) {
              if (apiError.includes("invalid credentials") || apiError.includes("unauthorized")) {
                errorMessage = "Invalid email/phone or password. Please check and try again.";
              } else if (apiError.includes("not found") || apiError.includes("does not exist")) {
                errorMessage = "No account found with this email/phone. Please sign up first.";
              } else {
                errorMessage = apiError;
              }
            }
          } else {
            const text = await res.text();
            errorMessage = text || `Server returned ${res.status}`;
          }
        } catch {
          errorMessage = `Server returned ${res.status}`;
        }
        
        toast(errorMessage, "error");
        throw new Error(errorMessage);
      }

      const data = await res.json();
      
      // Store token using auth store
      setToken(data.token);
      toast("Login successful! Welcome back!", "success");
      setSuccess(true);

      // Redirect after short delay
      const redirect = searchParams?.get("redirect") || "/";
      setTimeout(() => {
        router.push(redirect);
      }, 1500);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-6 sm:py-8 md:py-12 px-3 sm:px-4 md:px-6 lg:px-8">
      <TurnstileGate onHumanVerified={setHumanOk} />
      <div className="max-w-md w-full space-y-6 sm:space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="bg-emerald-600 p-2.5 sm:p-3 rounded-full">
              <LogIn className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
            </div>
          </div>
          <h2 className="mt-4 sm:mt-6 text-center text-2xl sm:text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-xs sm:text-sm text-gray-600">
            Or{" "}
            <Link
              href="/signup"
              prefetch={false}
              className="font-medium text-emerald-600 hover:text-emerald-500 active:text-emerald-700 touch-manipulation"
            >
              create a new account
            </Link>
          </p>
        </div>

        <form className="mt-6 sm:mt-8 space-y-4 sm:space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center">
              <XCircle className="w-5 h-5 text-red-600 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center">
              <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
              <p className="text-sm text-green-700">Login successful! Redirecting...</p>
            </div>
          )}

          <div className="space-y-3 sm:space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                Email or Phone
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none relative block w-full pl-9 sm:pl-10 pr-3 py-2.5 sm:py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 text-sm sm:text-base touch-manipulation"
                  placeholder="Email or phone number"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none relative block w-full pl-9 sm:pl-10 pr-3 py-2.5 sm:py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 text-sm sm:text-base touch-manipulation"
                  placeholder="Enter your password"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="submit"
              disabled={loading || success || (isTurnstileSiteConfigured() && !humanOk)}
              className="group relative w-full flex justify-center py-2.5 sm:py-3 px-4 border border-transparent text-sm sm:text-base font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed touch-manipulation"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5 mr-2" />
                  Sign in
                </>
              )}
            </button>
            
            {googleClientId && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
                  </div>
                </div>

                <GoogleLoginButton />
              </>
            )}
          </div>

          <div className="text-center">
            <Link
              href="/forgot-password"
              prefetch={false}
              className="text-sm text-emerald-600 hover:text-emerald-500"
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-6 sm:py-8 md:py-12 px-3 sm:px-4 md:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6 sm:space-y-8">
        <div className="flex justify-center">
          <div className="bg-emerald-600 p-2.5 sm:p-3 rounded-full">
            <LogIn className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
          </div>
        </div>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  
  // Always wrap with provider, but pass clientId to content
  // Wrap LoginPageContent in Suspense because it uses useSearchParams
  return (
    <GoogleOAuthProvider clientId={googleClientId || "dummy"}>
      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent googleClientId={googleClientId} />
      </Suspense>
    </GoogleOAuthProvider>
  );
}

