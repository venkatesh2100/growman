"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2, Lock, LogIn, Mail, XCircle } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import {
  TurnstileGate,
  isTurnstileSiteConfigured,
} from "../../components/TurnstileGate";

export default function AdminLoginPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const setToken = useAuthStore((state) => state.setToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [humanOk, setHumanOk] = useState(() => !isTurnstileSiteConfigured());

  useEffect(() => {
    const verifyExistingSession = async () => {
      if (!token) return;
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.role === "admin" || data?.role === "superadmin") {
          router.replace("/");
        }
      } catch {
        // Ignore; user will continue with login form.
      }
    };
    verifyExistingSession();
  }, [token, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isTurnstileSiteConfigured() && !humanOk) {
      setError("Please complete the security check first.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/auth/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Invalid email/phone or password.");
      }

      const data = await res.json();
      setToken(data.token);
      setSuccess(true);
      setTimeout(() => router.push("/"), 900);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-8 px-4">
      <TurnstileGate onHumanVerified={setHumanOk} />
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="bg-emerald-600 p-3 rounded-full">
              <LogIn className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Admin Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to manage products and orders
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center">
              <XCircle className="w-5 h-5 text-red-600 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center">
              <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
              <p className="text-sm text-green-700">Login successful. Redirecting...</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email or Phone
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Email or phone number"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Enter your password"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || success || (isTurnstileSiteConfigured() && !humanOk)}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-base font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none disabled:bg-gray-400 disabled:cursor-not-allowed"
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

          <div className="text-center">
            <Link
              href="/"
              className="text-sm text-emerald-600 hover:text-emerald-500"
            >
              Go back to admin home
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
