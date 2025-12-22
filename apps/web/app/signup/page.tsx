"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { UserPlus, Mail, Lock, Phone, User, Loader2, XCircle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { toast } from "../../lib/toast";
// import GoogleSignupButton from "./GoogleSignupButton";

// Helper function to safely parse error responses and return user-friendly messages
async function parseErrorResponse(res: Response): Promise<{ message: string; showToast: boolean }> {
  const contentType = res.headers.get("content-type");
  const status = res.status;
  let errorMessage = "An error occurred";
  const showToast = true;
  
  // Handle specific status codes with user-friendly messages
  if (status === 429) {
    return {
      message: "Too many requests. Please wait a minute before requesting another OTP.",
      showToast: true,
    };
  }
  
  if (status === 404) {
    return {
      message: "Service temporarily unavailable. Please try again later.",
      showToast: true,
    };
  }
  
  if (status === 500) {
    return {
      message: "Server error. Please try again in a moment.",
      showToast: true,
    };
  }
  
  try {
    if (contentType && contentType.includes("application/json")) {
      const errorData = await res.json();
      const apiError = errorData.error || errorData.message;
      
      // Map common API errors to user-friendly messages
      if (apiError) {
        if (apiError.includes("wait") || apiError.includes("rate limit") || apiError.includes("too many")) {
          errorMessage = "Too many requests. Please wait a minute before requesting another OTP.";
        } else if (apiError === "user_exists") {
          errorMessage = "An account with this email already exists. Please login instead.";
        } else if (apiError.includes("invalid email") || apiError.includes("email format")) {
          errorMessage = "Please enter a valid email address.";
        } else if (apiError.includes("OTP") && apiError.includes("invalid")) {
          errorMessage = "Invalid OTP. Please check and try again.";
        } else if (apiError.includes("expired")) {
          errorMessage = "OTP has expired. Please request a new one.";
        } else {
          errorMessage = apiError;
        }
      } else {
        errorMessage = `Server returned ${status}`;
      }
    } else {
      const text = await res.text();
      if (text) {
        // Try to parse as JSON if it looks like JSON
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.error || errorData.message || text.trim() || `Server returned ${status}`;
        } catch (_) {
          // If not JSON, use the text or status
          errorMessage = text.trim() || `Server returned ${status}`;
        }
      } else {
        errorMessage = `Server returned ${status}`;
      }
    }
  } catch (_) {
    // If parsing fails, return status code
    console.error("Error parsing error response:", _);
    errorMessage = `Server returned ${status}`;
  }
  
  return { message: errorMessage, showToast };
}

function SignupPageContent({ googleClientId }: { googleClientId: string }) {
  const router = useRouter();
  const setToken = useAuthStore((state) => state.setToken);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "phone") {
      // Only allow digits, max 10
      setFormData({ ...formData, [name]: value.replace(/\D/g, "").slice(0, 10) });
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
    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return false;
    }
    return true;
  };

  const handleSendOTP = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use checkout OTP endpoint which handles new user verification
      const res = await apiFetch("/checkout/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: formData.email }),
      });

      if (!res.ok) {
        const { message, showToast } = await parseErrorResponse(res);
        if (showToast) {
          toast(message, "error");
        }
        throw new Error(message);
      }

      toast("Verification code sent to your email!", "success");
      setOtpSent(true);
    } catch (err: any) {
      const errorMsg = err.message || "Failed to send verification email. Please try again.";
      setError(errorMsg);
      // Only show toast if not already shown
      if (!err.message || !err.message.includes("Too many requests")) {
        toast(errorMsg, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length !== 6) {
      setError("Please enter a valid 6-digit OTP");
      return;
    }

    setVerifyingOtp(true);
    setError(null);

    try {
      // Use checkout verify OTP endpoint
      const res = await apiFetch("/checkout/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: formData.email, otp }),
      });

      if (!res.ok) {
        const { message, showToast } = await parseErrorResponse(res);
        if (showToast) {
          toast(message, "error");
        }
        throw new Error(message);
      }

      toast("Email verified successfully!", "success");
      setEmailVerified(true);
      // Proceed with signup
      await handleSignup();
    } catch (err: any) {
      const errorMsg = err.message || "Invalid OTP. Please try again.";
      setError(errorMsg);
      // Only show toast if not already shown
      if (!err.message || !err.message.includes("Invalid OTP")) {
        toast(errorMsg, "error");
      }
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
        const { message, showToast } = await parseErrorResponse(res);
        if (showToast) {
          toast(message, "error");
        }
        throw new Error(message);
      }

      const data = await res.json();
      
      // Store token using auth store
      setToken(data.token);
      toast("Account created successfully! Welcome!", "success");
      setSuccess(true);

      // Redirect after short delay
      setTimeout(() => {
        router.push("/");
      }, 1500);
    } catch (err: any) {
      const errorMsg = err.message || "Signup failed. Please try again.";
      setError(errorMsg);
      // Only show toast if not already shown
      if (!err.message || !err.message.includes("Signup failed")) {
        toast(errorMsg, "error");
      }
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
              <UserPlus className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-emerald-600 hover:text-emerald-500"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={(e) => { e.preventDefault(); }}>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center">
              <XCircle className="w-5 h-5 text-red-600 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center">
              <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
              <p className="text-sm text-green-700">Account created successfully! Redirecting...</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                  placeholder="John Doe"
                />
              </div>
            </div>

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
                  value={formData.email}
                  onChange={handleChange}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={handleChange}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                  placeholder="9876543210"
                  maxLength={10}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">10 digits, starting with 6-9</p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
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
                  value={formData.password}
                  onChange={handleChange}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                  placeholder="At least 6 characters"
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
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="appearance-none relative block w-full pl-10 pr-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 focus:z-10 sm:text-sm"
                  placeholder="Confirm your password"
                />
              </div>
            </div>
          </div>

          {!otpSent ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleSendOTP}
                disabled={loading || success}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending verification email...
                  </>
                ) : (
                  <>
                    <Mail className="w-5 h-5 mr-2" />
                    Verify Email
                  </>
                )}
              </button>
{/* 
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

                  <GoogleSignupButton />
                </>
              )} */}
            </div>
          ) : !emailVerified ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                  Enter 6-digit OTP sent to {formData.email}
                </label>
                <input
                  id="otp"
                  name="otp"
                  type="text"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="appearance-none relative block w-full px-4 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 text-center text-2xl tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                />
              </div>
              <button
                type="button"
                onClick={handleVerifyOTP}
                disabled={verifyingOtp || otp.length !== 6}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {verifyingOtp ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify OTP"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtp("");
                }}
                className="w-full text-sm text-emerald-600 hover:text-emerald-700"
              >
                Resend OTP
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

export default function SignupPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  
  // Always wrap with provider, but pass clientId to content
  return (
    <GoogleOAuthProvider clientId={googleClientId || "dummy"}>
      <SignupPageContent googleClientId={googleClientId} />
    </GoogleOAuthProvider>
  );
}

