"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import {
  Mail,
  Lock,
  Phone,
  User,
  Eye,
  EyeOff,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { toast } from "../../lib/toast";
import {
  TurnstileGate,
  isTurnstileSiteConfigured,
} from "../../components/TurnstileGate";
import { readApiError } from "../../lib/errors";
import { PillField, OtpField } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";

function mapSignupError(code: string, status: number): string {
  const key = code.toLowerCase();

  if (status === 429 || key.includes("cooldown") || key.includes("too many")) {
    return "Wait a minute before requesting another code.";
  }
  if (key === "user_exists") {
    return "This email is already registered. Sign in instead.";
  }
  if (key.includes("invalid email") || key.includes("email format")) {
    return "Enter a valid email address.";
  }
  if (key.includes("invalid") && key.includes("otp")) {
    return "That code is wrong or expired.";
  }
  if (key.includes("expired")) {
    return "That code expired. Request a new one.";
  }
  if (
    key === "email_send_failed" ||
    key === "email_unavailable" ||
    key === "otp_unavailable" ||
    status === 502 ||
    status === 503
  ) {
    return "Couldn't send the verification email. Try again.";
  }
  if (status >= 500) {
    return "Couldn't send the verification email. Try again.";
  }
  if (code && !key.includes(" ") && key.includes("_")) {
    return "Something went wrong. Try again.";
  }
  return code || "Something went wrong. Try again.";
}

async function parseErrorResponse(res: Response): Promise<{ message: string }> {
  const { code, status } = await readApiError(res);
  return { message: mapSignupError(code, status) };
}

function SignupPageContent({ googleClientId }: { googleClientId: string }) {
  void googleClientId;
  const router = useRouter();
  const setToken = useAuthStore((state) => state.setToken);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [humanOk, setHumanOk] = useState(() => !isTurnstileSiteConfigured());

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setError(null);
    if (name === "phone") {
      setFormData({
        ...formData,
        [name]: value.replace(/\D/g, "").slice(0, 10),
      });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError("Name is required");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim() || !emailRegex.test(formData.email)) {
      setError("Valid email is required");
      return false;
    }
    const phoneRegex = /^[6-9][0-9]{9}$/;
    if (!formData.phone.trim() || !phoneRegex.test(formData.phone)) {
      setError("Valid 10-digit phone number is required (starting with 6-9)");
      return false;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return false;
    }
    return true;
  };

  const handleSendOTP = async () => {
    if (!validateForm()) {
      return;
    }

    if (isTurnstileSiteConfigured() && !humanOk) {
      toast("Please complete the security check (bottom-right).", "error");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/checkout/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: formData.email }),
      });
      setCooldown(60);

      if (!res.ok) {
        const { message } = await parseErrorResponse(res);
        setError(message);
        toast(message, "error");
        return;
      }

      toast("Code sent to your email.", "success");
      setOtpSent(true);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Couldn't send the verification email. Try again.";
      setError(errorMsg);
      toast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    if (isTurnstileSiteConfigured() && !humanOk) {
      toast("Please complete the security check (bottom-right).", "error");
      return;
    }

    setVerifyingOtp(true);
    setError(null);

    try {
      const res = await apiFetch("/checkout/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: formData.email, otp }),
      });

      if (!res.ok) {
        const { message } = await parseErrorResponse(res);
        setError(message);
        toast(message, "error");
        return;
      }

      toast("Email verified.", "success");
      setEmailVerified(true);
      await handleSignup();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "That code is wrong or expired.";
      setError(errorMsg);
      toast(errorMsg, "error");
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSignup = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
        }),
      });

      if (!res.ok) {
        const { message } = await parseErrorResponse(res);
        setError(message);
        toast(message, "error");
        return;
      }

      const data = await res.json();
      setToken(data.token);
      toast("Account created.", "success");
      setSuccess(true);

      setTimeout(() => {
        router.push("/");
      }, 1500);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Couldn't create your account. Try again.";
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
            Create your account
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Already have an account?{" "}
            <Link
              href="/login"
              prefetch={false}
              className="font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          {error ? (
            <p className="text-sm text-green-950/55">{error}</p>
          ) : null}

          {success ? (
            <p className="text-sm text-emerald-700">Account created. Redirecting…</p>
          ) : null}

          {!otpSent ? (
            <>
              <PillField
                id="name"
                name="name"
                type="text"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Full name"
                icon={<User className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
              />

              <PillField
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="Email address"
                icon={<Mail className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
              />

              <div>
                <PillField
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="Phone number"
                  maxLength={10}
                  icon={<Phone className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
                />
                <p className="mt-1.5 px-1 text-xs text-gray-500">
                  10 digits, starting with 6–9
                </p>
              </div>

              <PillField
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="Password (min. 8 characters)"
                icon={<Lock className="mr-3 h-5 w-5 shrink-0 text-gray-400" />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                }
              />

              <Button
                type="button"
                variant="pill-primary"
                onClick={handleSendOTP}
                disabled={success || (isTurnstileSiteConfigured() && !humanOk)}
                loading={loading}
                loadingText="Sending verification email..."
                icon={<Mail className="h-5 w-5" />}
              >
                Verify email
              </Button>
            </>
          ) : !emailVerified ? (
            <>
              <p className="text-sm text-gray-500">
                Enter the 6-digit code sent to{" "}
                <span className="font-medium text-gray-800">{formData.email}</span>
              </p>

              <OtpField
                id="otp"
                name="otp"
                required
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />

              <Button
                type="button"
                variant="pill-primary"
                onClick={handleVerifyOTP}
                disabled={otp.length !== 6 || (isTurnstileSiteConfigured() && !humanOk)}
                loading={verifyingOtp}
                loadingText="Verifying..."
              >
                Verify OTP
              </Button>

              <button
                disabled={
                  cooldown > 0 || (isTurnstileSiteConfigured() && !humanOk)
                }
                type="button"
                onClick={handleSendOTP}
                className="w-full py-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
              </button>
            </>
          ) : null}
        </form>
      </div>
    </div>
  );
}

export default function SignupPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  return (
    <GoogleOAuthProvider clientId={googleClientId || "dummy"}>
      <SignupPageContent googleClientId={googleClientId} />
    </GoogleOAuthProvider>
  );
}
