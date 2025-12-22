"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { Mail, Lock, Loader2, XCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { toast } from "../../lib/toast";

type Step = "email" | "otp" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);

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
        let errorMessage = "Failed to send OTP";
        const status = res.status;
        
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            const apiError = errorData.error || errorData.message;
            
            if (apiError) {
              if (apiError.includes("wait") || apiError.includes("rate limit") || apiError.includes("too many") || status === 429) {
                errorMessage = "Too many requests. Please wait a minute before requesting another OTP.";
              } else if (apiError.includes("not found") || apiError.includes("does not exist")) {
                errorMessage = "No account found with this email address.";
              } else {
                errorMessage = apiError;
              }
            }
          } else {
            const text = await res.text();
            if (text) {
              try {
                const errorData = JSON.parse(text);
                errorMessage = errorData.error || errorData.message || text;
              } catch {
                errorMessage = text || errorMessage;
              }
            }
          }
        } catch {
          // If parsing fails, use status-based message
          if (status === 429) {
            errorMessage = "Too many requests. Please wait a minute before requesting another OTP.";
          }
        }
        
        toast(errorMessage, "error");
        throw new Error(errorMessage);
      }

      // Consume the response body to clear the stream
      try {
        await res.text();
      } catch {
        // Ignore if reading fails
      }

      toast("OTP sent to your email!", "success");
      setStep("otp");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send OTP. Please try again.";
      setError(errorMessage);
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
        let errorMessage = "Invalid OTP";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            const apiError = errorData.error || errorData.message;
            if (apiError) {
              if (apiError.includes("expired")) {
                errorMessage = "OTP has expired. Please request a new one.";
              } else if (apiError.includes("invalid") || apiError.includes("incorrect")) {
                errorMessage = "Invalid OTP. Please check and try again.";
              } else {
                errorMessage = apiError;
              }
            }
          } else {
            const text = await res.text();
            if (text) {
              try {
                const errorData = JSON.parse(text);
                errorMessage = errorData.error || errorData.message || text;
              } catch {
                errorMessage = text || errorMessage;
              }
            }
          }
        } catch {
          // If parsing fails, use default message
        }
        
        toast(errorMessage, "error");
        throw new Error(errorMessage);
      }

      // Consume the response body to clear the stream
      try {
        await res.text();
      } catch {
        // Ignore if reading fails
      }

      toast("OTP verified successfully!", "success");
      setStep("reset");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Invalid or expired OTP";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      const errorMsg = "Password must be at least 6 characters";
      setError(errorMsg);
      toast(errorMsg, "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      const errorMsg = "Passwords do not match";
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
        let errorMessage = "Failed to reset password";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } else {
            const text = await res.text();
            if (text) {
              try {
                const errorData = JSON.parse(text);
                errorMessage = errorData.error || errorData.message || text;
              } catch {
                errorMessage = text || errorMessage;
              }
            }
          }
        } catch {
          // If parsing fails, use default message
        }
        
        toast(errorMessage, "error");
        throw new Error(errorMessage);
      }

      // Consume the response body to clear the stream
      try {
        await res.text();
      } catch {
        // Ignore if reading fails
      }

      toast("Password reset successfully! Redirecting to login...", "success");
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to reset password";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="bg-emerald-600 p-3 rounded-full">
              <Lock className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {step === "email" && "Forgot Password"}
            {step === "otp" && "Verify OTP"}
            {step === "reset" && "Reset Password"}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {step === "email" && "Enter your email address and we'll send you a verification code"}
            {step === "otp" && "Enter the verification code sent to your email"}
            {step === "reset" && "Enter your new password"}
          </p>
        </div>

        <div className="mt-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center">
              <XCircle className="w-5 h-5 text-red-600 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {step === "email" && (
            <form onSubmit={handleSendOTP} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                    placeholder="Enter your email"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={sendingOtp}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {sendingOtp ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending OTP...
                  </>
                ) : (
                  "Send Verification Code"
                )}
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                  Verification Code
                </label>
                <input
                  id="otp"
                  name="otp"
                  type="text"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm text-center text-2xl tracking-widest"
                  placeholder="000000"
                />
                <p className="mt-2 text-xs text-gray-500 text-center">
                  Enter the 6-digit code sent to {email}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                    setError(null);
                  }}
                  className="flex-1 py-3 px-4 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-2" />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="flex-1 py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin inline" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </button>
              </div>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                    placeholder="Enter new password"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                    placeholder="Confirm new password"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("otp");
                    setNewPassword("");
                    setConfirmPassword("");
                    setError(null);
                  }}
                  className="flex-1 py-3 px-4 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-2" />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
                  className="flex-1 py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin inline" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm text-emerald-600 hover:text-emerald-500 flex items-center justify-center"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

