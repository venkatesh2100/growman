"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { Mail, Lock, ArrowLeft, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "../../lib/toast";
import { readApiError } from "../../lib/errors";
import { PillField, OtpField } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";

type Step = "email" | "otp" | "reset";

function mapError(code: string, status: number, fallback: string, retryAfter?: number): string {
  const key = code.toLowerCase();
  if (status === 429 || key.includes("wait") || key.includes("cooldown") || key.includes("rate") || key.includes("too many")) {
    if (retryAfter && retryAfter > 0) {
      return `Wait ${retryAfter}s before requesting another code.`;
    }
    return "Wait a minute before requesting another code.";
  }
  if (key.includes("not found") || key.includes("does not exist")) {
    return "No account with that email.";
  }
  if (key.includes("expired")) {
    return "That code expired. Request a new one.";
  }
  if (key.includes("invalid") || key.includes("incorrect")) {
    return "That code is wrong or expired.";
  }
  if (key === "email_send_failed" || key === "email_unavailable") {
    return "Couldn't send the code. Try again.";
  }
  if (
    key === "otp_unavailable" ||
    key.includes("failed to verify") ||
    status === 502 ||
    status === 503
  ) {
    return fallback;
  }
  if (status >= 500) {
    return fallback;
  }
  return code || fallback;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const { code, status, retryAfter } = await readApiError(res);
  return mapError(code, status, fallback, retryAfter);
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);

  const titles: Record<Step, { title: string; subtitle: string }> = {
    email: {
      title: "Forgot password",
      subtitle: "We'll send a code to your email.",
    },
    otp: {
      title: "Enter code",
      subtitle: `Sent to ${email}`,
    },
    reset: {
      title: "New password",
      subtitle: "Choose a password you'll remember.",
    },
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSendingOtp(true);

    try {
      const res = await apiFetch("/auth/forgot-password/send-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const errorMessage = await readError(res, "Couldn't send the code. Try again.");
        setError(errorMessage);
        toast(errorMessage, "error");
        return;
      }

      try {
        await res.text();
      } catch {
        // ignore
      }

      toast("Code sent to your email.", "success");
      setStep("otp");
    } catch {
      const errorMessage = "No connection. Check your internet and try again.";
      setError(errorMessage);
      toast(errorMessage, "error");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch("/auth/forgot-password/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });

      if (!res.ok) {
        const errorMessage = await readError(res, "Couldn't verify the code. Try again.");
        setError(errorMessage);
        toast(errorMessage, "error");
        return;
      }

      try {
        await res.text();
      } catch {
        // ignore
      }

      toast("Code verified.", "success");
      setStep("reset");
    } catch {
      const errorMessage = "That code is wrong or expired.";
      setError(errorMessage);
      toast(errorMessage, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      const errorMsg = "Password must be at least 8 characters.";
      setError(errorMsg);
      toast(errorMsg, "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      const errorMsg = "Passwords don't match.";
      setError(errorMsg);
      toast(errorMsg, "error");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/auth/forgot-password/reset", {
        method: "POST",
        body: JSON.stringify({
          email,
          otp,
          newPassword,
          confirmPassword,
        }),
      });

      if (!res.ok) {
        const errorMessage = await readError(res, "Couldn't reset password. Try again.");
        setError(errorMessage);
        toast(errorMessage, "error");
        return;
      }

      try {
        await res.text();
      } catch {
        // ignore
      }

      toast("Password updated. Sign in.", "success");
      setTimeout(() => {
        router.push("/login");
      }, 1200);
    } catch {
      const errorMessage = "Couldn't reset password. Try again.";
      setError(errorMessage);
      toast(errorMessage, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-md flex-col justify-center">
        <Link
          href={step === "email" ? "/login" : "#"}
          prefetch={false}
          onClick={(e) => {
            if (step === "otp") {
              e.preventDefault();
              setStep("email");
              setOtp("");
              setError(null);
            } else if (step === "reset") {
              e.preventDefault();
              setStep("otp");
              setNewPassword("");
              setConfirmPassword("");
              setError(null);
            }
          }}
          className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-xl text-green-900 transition-colors hover:bg-emerald-50"
          aria-label="Back"
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
            {titles[step].title}
          </h1>
          <p className="mt-2 text-sm text-gray-500">{titles[step].subtitle}</p>
        </div>

        {error ? <p className="mb-4 text-sm text-green-950/55">{error}</p> : null}

        {step === "email" && (
          <form onSubmit={handleSendOTP} className="space-y-4">
            <PillField
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="Email address"
              icon={<Mail className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
            />

            <Button
              type="submit"
              variant="pill-primary"
              disabled={!email.trim()}
              loading={sendingOtp}
              loadingText="Sending…"
            >
              Send code
            </Button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerifyOTP} className="space-y-4">
            <OtpField
              id="otp"
              name="otp"
              required
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
            />

            <Button
              type="submit"
              variant="pill-primary"
              disabled={otp.length !== 6}
              loading={loading}
              loadingText="Verifying…"
            >
              Verify code
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setOtp("");
                setError(null);
              }}
              className="w-full py-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
            >
              Use a different email
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <PillField
              id="newPassword"
              name="newPassword"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError(null);
              }}
              placeholder="New password (min. 8)"
              icon={<Lock className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              }
            />

            <PillField
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirm ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
              }}
              placeholder="Confirm password"
              icon={<Lock className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600"
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              }
            />

            <div className="flex gap-3">
              <Button
                type="button"
                variant="pill-secondary"
                onClick={() => {
                  setStep("otp");
                  setNewPassword("");
                  setConfirmPassword("");
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="pill-primary"
                className="flex-[1.4]"
                disabled={newPassword.length < 8 || newPassword !== confirmPassword}
                loading={loading}
                loadingText="Saving…"
              >
                Save password
              </Button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <Link
            href="/login"
            prefetch={false}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
