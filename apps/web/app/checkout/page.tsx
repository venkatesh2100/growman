"use client";

import { useEffect, useState } from "react";
import {  useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { ShoppingBag, CreditCard, CheckCircle, Loader2, Mail, LogIn, Navigation } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import { indianStates, getAllStateNames } from "../../lib/data/indianStatesCities";
import { getCurrentLocation } from "../../lib/utils/geolocation";
import { toast } from "../../lib/toast";
import { FormField, FormSelect } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";

// Razorpay types
interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void | Promise<void>;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
  theme: {
    color: string;
  };
  modal: {
    ondismiss: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
}

// CartItem type is imported from cartStore, no need to redefine

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const cart = useCartStore((state) => state.items);
  const getSubtotal = useCartStore((state) => state.getSubtotal);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "processing" | "success" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // Removed unused checkingUser state
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
    addressLine: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
  });

  useEffect(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Auto-fill address if user is logged in
    if (isAuthenticated) {
      loadUserAddress();
      // Auto-verify email for logged-in users (skip OTP)
      setOtpVerified(true);
    } else {
      // Reset OTP verification for non-logged-in users
      setOtpVerified(false);
      setOtpSent(false);
      setOtp("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Note: City is now a free text input, so we don't need to filter cities based on state
const handleCart = () =>{
  router.push("/cart");
}
  const loadUserAddress = async () => {
    try {
      const res = await apiFetch("/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.address) {
          setCustomerInfo({
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
            addressLine: data.address.line || "",
            city: data.address.city || "",
            state: data.address.state || "",
            pincode: data.address.pincode || "",
            country: data.address.country || "India",
          });
        }
      }
    } catch (error) {
      console.error("Error loading user address:", error);
    }
  };

  const handleLocateMe = async () => {
    setLocating(true);
    try {
      const locationData = await getCurrentLocation();

      // Find matching state from Indian states
      let matchedState = "";
      if (locationData.state) {
        const stateMatch = indianStates.find(
          (state) =>
            state.name.toLowerCase().includes(locationData.state!.toLowerCase()) ||
            locationData.state!.toLowerCase().includes(state.name.toLowerCase())
        );
        if (stateMatch) {
          matchedState = stateMatch.name;
        }
      }

      const updatedInfo = {
        ...customerInfo,
        addressLine: locationData.addressLine || customerInfo.addressLine,
        city: locationData.city || customerInfo.city,
        state: matchedState || customerInfo.state,
        pincode: locationData.pincode || customerInfo.pincode,
        country: locationData.country || "India",
      };

      setCustomerInfo(updatedInfo);


      // Save location to backend if user is authenticated
      if (isAuthenticated && locationData.latitude && locationData.longitude) {
        try {
          const res = await apiFetch("/auth/save-location", {
            method: "POST",
            body: JSON.stringify({
              addressLine: updatedInfo.addressLine,
              city: updatedInfo.city,
              state: updatedInfo.state,
              pincode: updatedInfo.pincode,
              country: updatedInfo.country,
              latitude: locationData.latitude,
              longitude: locationData.longitude,
            }),
          });

          if (!res.ok) {
            console.error("Failed to save location to backend");
          }
        } catch (error) {
          console.error("Error saving location:", error);
          // Don't show error to user, location is still filled in form
        }
      }
    } catch (error: unknown) {
      setError(`Failed to get location: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLocating(false);
    }
  };

  // Check if user exists when email or phone is entered
  const checkUserExists = async (email?: string, phone?: string) => {
    if (!email && !phone) return;
    try {
      const params = new URLSearchParams();
      if (email) params.append("email", email);
      if (phone) params.append("phone", phone);

      const res = await apiFetch(`/auth/check-user?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists && !isAuthenticated) {
          // User exists but not logged in - redirect to login
          setShowLoginPrompt(true);
          setError("An account with this email or phone already exists. Please login to continue.");
          return true;
        }
      }
    } catch (error) {
      console.error("Error checking user:", error);
    }
    return false;
  };

  const subtotal = getSubtotal();
  // Tax calculation commented out for now (as per requirements)
  // const tax = subtotal * 0.18; // 18% GST
  const discount = 0; // Can be calculated from MRP vs price
  const shipping = subtotal > 500 ? 0 : 0;
  const total = subtotal - discount + shipping;

  // Load Razorpay Script
  const loadRazorpay = () => {
    return new Promise<boolean>((resolve) => {
      if ((window as { Razorpay?: unknown }).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleSendOTP = async () => {
    // Skip if user is logged in
    if (isAuthenticated) {
      setOtpVerified(true);
      return;
    }

    // Basic email validation only
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!customerInfo.email.trim() || !emailRegex.test(customerInfo.email)) {
      setError("Please enter a valid email address");
      return;
    }

    setSendingOtp(true);
    setError(null);

    try {
      const res = await apiFetch("/checkout/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: customerInfo.email }),
      });

      if (!res.ok) {
        let errorMessage = "Could not send OTP";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await res.json();
            if (errorData.error === "user_exists") {
              setShowLoginPrompt(true);
              errorMessage = "An account with this email already exists. Please login to continue.";
              toast(errorMessage, "info");
              setError(errorMessage);
              return;
            }
            if (errorData.error) {
              if (errorData.error.includes("wait") || errorData.error.includes("rate limit") || errorData.error.includes("too many")) {
                errorMessage = "Too many requests. Please wait a minute before requesting another OTP.";
              } else {
                errorMessage = errorData.error;
              }
            }
          }
        } catch {
          // If parsing fails, use default message
        }

        // Don't block checkout if OTP fails - allow user to skip
        toast(errorMessage + ". You can skip verification and proceed to payment.", "error");
        setError(errorMessage);
        return;
      }

      toast("Verification code sent to your email!", "success");
      setOtpSent(true);
    } catch (err: unknown) {
      // Don't block checkout - allow skipping
      const errorMsg = err instanceof Error ? err.message : "Could not send OTP. You can skip verification and proceed to payment.";
      toast(errorMsg, "error");
      setError(errorMsg);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length !== 6) {
      const errorMsg = "Please enter a valid 6-digit OTP";
      toast(errorMsg, "error");
      setError(errorMsg);
      return;
    }

    setVerifyingOtp(true);
    setError(null);

    try {
      const res = await apiFetch("/checkout/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: customerInfo.email, otp }),
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
          }
        } catch {
          // If parsing fails, use default message
        }

        toast(errorMessage, "error");
        throw new Error(errorMessage);
      }

      toast("Email verified successfully!", "success");
      setOtpVerified(true);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Invalid OTP. Please try again.";
      setError(errorMsg);
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handlePayment = async () => {
    // Only require OTP verification for non-logged-in users
    if (!isAuthenticated && !otpVerified) {
      setError("Please verify your email with OTP first");
      return;
    }

    if (cart.length === 0) {
      setError("Your cart is empty");
      return;
    }

    setLoading(true);
    setError(null);
    setPaymentStatus("processing");

    try {
      const isLoaded = await loadRazorpay();
      if (!isLoaded) {
        setError("Payment gateway failed to load. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
        return;
      }

      // Prepare order items - validate product IDs
      const orderItems = cart
        .filter((item) => item.productId && item.productId > 0) // Filter out invalid product IDs
        .map((item) => ({
          productId: item.productId,
          productSizeId: item.productSizeId,
          quantity: item.quantity,
          price: item.price,
        }));

      if (orderItems.length === 0) {
        setError("Invalid cart items. Please add items to cart again.");
        setPaymentStatus("failed");
        setLoading(false);
        return;
      }

      // Create Razorpay order from backend
      const orderRes = await apiFetch("/checkout/create-order", {
        method: "POST",
        body: JSON.stringify({
          amount: total,
          currency: "INR",
          items: orderItems,
          customer: customerInfo,
        }),
      });

      if (!orderRes.ok) {
        const errorData = await orderRes.json();
        throw new Error(errorData.error || "Failed to create order");
      }

      const orderData = await orderRes.json();
      // console.log(orderData);
      // console.log('RAZOR',process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID)
      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
        amount: orderData.amount,
        currency: "INR",
        name: "Growman",
        description: `Order #${orderData.orderId}`,
        order_id: orderData.id || "",
        handler: async function (response: RazorpayResponse) {
          try {
            // Verify payment with backend
            const verifyRes = await apiFetch("/razorpay/verify", {
              method: "POST",
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              const errorData = await verifyRes.json().catch(() => ({ error: "Unknown error" }));
              console.error("Payment verification error:", errorData);
              throw new Error(errorData.error || "Payment verification failed");
            }

            setPaymentStatus("success");

            // Auto-save address if user entered new details and is not logged in
            // This will create a guest account or save to existing account
            if (!isAuthenticated && customerInfo.email) {
              try {
                // Save address to user account (create account if doesn't exist)
                await apiFetch("/checkout/save-address", {
                  method: "POST",
                  body: JSON.stringify({
                    email: customerInfo.email,
                    phone: customerInfo.phone,
                    name: customerInfo.name,
                    address: {
                      line: customerInfo.addressLine,
                      city: customerInfo.city,
                      state: customerInfo.state,
                      pincode: customerInfo.pincode,
                      country: customerInfo.country,
                    },
                  }),
                });
              } catch (err) {
                console.error("Error saving address:", err);
                // Don't block payment success if address save fails
              }
            }

            // Clear cart
            useCartStore.getState().clearCart();
            // Redirect to success page after 2 seconds
            setTimeout(() => {
              router.push(`/order-success?orderId=${orderData.orderId}`);
            }, 2000);
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Payment verification failed");
            setPaymentStatus("failed");
          } finally {
            setLoading(false);
          }
        },
        prefill: {
          name: customerInfo.name,
          email: customerInfo.email,
          contact: customerInfo.phone,
        },
        theme: {
          color: "#10b981",
        },
        modal: {
          ondismiss: function () {
            setLoading(false);
            setPaymentStatus("idle");
          },
        },
      };

      const Razorpay = (window as { Razorpay?: new (options: RazorpayOptions) => RazorpayInstance }).Razorpay;
      if (!Razorpay) {
        throw new Error("Razorpay SDK not loaded");
      }
      const paymentObject = new Razorpay(options);
      paymentObject.on("payment.failed", function () {
        setError("Payment failed. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
      });
      paymentObject.open();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred. Please try again.");
      setPaymentStatus("failed");
      setLoading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShoppingBag className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">Your cart is empty</h2>
          <p className="text-gray-600 mb-6">Add some plants to your cart to continue</p>
          <button
            onClick={() => router.push("/shop")}
            className="bg-emerald-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-emerald-700 transition-colors"
          >
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 md:py-8">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4 sm:mb-6 md:mb-8">Checkout</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
          {/* Left Column - Order Summary */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Information Form */}
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4 sm:mb-6 flex items-center">
                <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-emerald-600" />
                Customer Information
              </h2>
              <div className="space-y-3 sm:space-y-4">
                <FormField
                  size="sm"
                  label="Full Name *"
                  type="text"
                  value={customerInfo.name}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, name: e.target.value })
                  }
                  placeholder="John Doe"
                />
                <FormField
                  label="Email Address *"
                  type="email"
                  value={customerInfo.email}
                  onChange={async (e) => {
                    const email = e.target.value;
                    setCustomerInfo({ ...customerInfo, email });
                    // Check if email exists when user finishes typing
                    if (email.includes("@") && !isAuthenticated) {
                      await checkUserExists(email, undefined);
                    }
                  }}
                  onBlur={async () => {
                    if (customerInfo.email.includes("@") && !isAuthenticated) {
                      await checkUserExists(customerInfo.email, undefined);
                    }
                  }}
                  placeholder="john@example.com"
                />
                <FormField
                  label="Phone Number *"
                  type="tel"
                  value={customerInfo.phone}
                  onChange={async (e) => {
                    const phone = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setCustomerInfo({ ...customerInfo, phone });
                    // Check if phone exists when user finishes typing
                    if (phone.length === 10 && !isAuthenticated) {
                      await checkUserExists(undefined, phone);
                    }
                  }}
                  onBlur={async () => {
                    if (customerInfo.phone.length === 10 && !isAuthenticated) {
                      await checkUserExists(undefined, customerInfo.phone);
                    }
                  }}
                  placeholder="9876543210"
                  maxLength={10}
                  hint="10 digits, starting with 6-9"
                />
                <FormSelect
                  label="Country"
                  value={customerInfo.country}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, country: e.target.value })
                  }
                >
                  <option value="India">India</option>
                </FormSelect>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Address Line * (include Door No, Building Name, Street)
                  </label>
                  <button
                    type="button"
                    onClick={handleLocateMe}
                    disabled={locating}
                    className="flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50 mb-2"
                  >
                    {locating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Locating...
                      </>
                    ) : (
                      <>
                        <Navigation className="w-4 h-4" />
                        Locate Me
                      </>
                    )}
                  </button>
                </div>
                <FormField
                  type="text"
                  value={customerInfo.addressLine}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, addressLine: e.target.value })
                  }
                  placeholder="House/Flat No., Building Name, Street"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <FormSelect
                    size="sm"
                    label="State *"
                    value={customerInfo.state}
                    onChange={(e) =>
                      setCustomerInfo({
                        ...customerInfo,
                        state: e.target.value,
                      })
                    }
                  >
                    <option value="">Select State</option>
                    {getAllStateNames().map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </FormSelect>
                  <FormField
                    size="sm"
                    label="City *"
                    type="text"
                    value={customerInfo.city}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, city: e.target.value })
                    }
                    placeholder="Enter city name"
                  />
                </div>
                <FormField
                  label="Pincode *"
                  type="text"
                  value={customerInfo.pincode}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
                  }
                  placeholder="123456"
                  maxLength={6}
                  hint="6 digits, starting with 1-9"
                />
              </div>
            </div>

            {/* Email OTP Verification - Only for non-logged-in users */}
            {!isAuthenticated && !otpVerified && (
              <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-emerald-200">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                  <Mail className="w-5 h-5 mr-2 text-emerald-600" />
                  Verify Email (Optional)
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  Verify your email to receive order updates. You can skip this and proceed directly to payment.
                </p>
                {!otpSent ? (
                  <Button
                    onClick={handleSendOTP}
                    disabled={!customerInfo.email}
                    loading={sendingOtp}
                    loadingText="Sending OTP..."
                    icon={<Mail className="w-5 h-5" />}
                  >
                    Send OTP to {customerInfo.email || "your email"}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <FormField
                      label="Enter 6-digit OTP"
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="text-center text-2xl tracking-widest"
                      placeholder="000000"
                      maxLength={6}
                    />
                    <Button
                      onClick={handleVerifyOTP}
                      disabled={otp.length !== 6}
                      loading={verifyingOtp}
                      loadingText="Verifying..."
                    >
                      Verify OTP
                    </Button>
                    <button
                      onClick={() => {
                        setOtpSent(false);
                        setOtp("");
                      }}
                      className="w-full text-emerald-600 py-2 text-sm hover:text-emerald-700"
                    >
                      Resend OTP
                    </button>
                  </div>
                )}
                {otpVerified && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                    <p className="text-sm text-green-700">Email verified successfully!</p>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => {
                      // Allow skipping OTP verification
                      setOtpVerified(true);
                    }}
                    className="w-full text-gray-600 py-2 text-sm hover:text-gray-800 underline"
                  >
                    Skip verification and proceed to payment
                  </button>
                </div>
              </div>
            )}

            {/* Show verification status for logged-in users */}
            {isAuthenticated && (
              <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-green-200">
                <div className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Email Verified</h3>
                    <p className="text-xs text-gray-600">You&apos;re logged in. No verification needed.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Login Prompt Modal */}
            {showLoginPrompt && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
                  <div className="flex items-center mb-4">
                    <LogIn className="w-6 h-6 text-emerald-600 mr-2" />
                    <h2 className="text-xl font-semibold text-gray-900">Account Already Exists</h2>
                  </div>
                  <p className="text-gray-600 mb-6">
                    An account with this email already exists. Please login to continue with your order.
                  </p>
                  <div className="flex gap-3">
                    <Link
                      href={`/login?email=${encodeURIComponent(customerInfo.email)}&phone=${encodeURIComponent(customerInfo.phone)}&redirect=/checkout`}
                      prefetch={false}
                      className="flex-1 bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center"
                    >
                      <LogIn className="w-5 h-5 mr-2" />
                      Login
                    </Link>
                    <button
                      onClick={() => {
                        setShowLoginPrompt(false);
                        setError(null);
                      }}
                      className="px-4 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Order Items */}
            <div className="bg-white md:rounded-xl md:shadow-sm md:p-6 p-3">
              <h2 className="text-lg md:text-xl font-semibold text-gray-900 mb-4 md:mb-6">Order Items</h2>
              <div onClick={handleCart} className="space-y-2 md:space-y-4">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 md:gap-4 p-2.5 md:p-4 md:border md:border-gray-200 md:rounded-lg"
                  >
                    {/* Mobile: Minimal design */}
                    <div className="md:hidden flex items-center gap-2.5 w-full">
                      <Image
                        src={item.image}
                        width={60}
                        height={60}
                        className="w-14 h-14 rounded object-cover shrink-0"
                        alt={item.name}
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 line-clamp-1">{item.name}</h3>
                        {item.label && (
                          <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-0.5">
                          Qty: {item.quantity}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        ₹{(item.price * item.quantity).toFixed(0)}
                      </span>
                    </div>

                    {/* Desktop: Original design */}
                    <div className="hidden md:flex md:items-center md:gap-4 md:w-full">
                    <Image
                      src={item.image}
                      width={80}
                      height={80}
                      className="w-20 h-20 rounded-lg object-cover"
                      alt={item.name}
                    />
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{item.name}</h3>
                      {item.label && (
                        <p className="text-sm text-gray-500">{item.label}</p>
                      )}
                      <p className="text-sm text-gray-600 mt-1">
                        Quantity: {item.quantity}
                      </p>
                    </div>
                    <span className="text-lg font-semibold text-gray-900">
                      ₹{(item.price * item.quantity).toFixed(2)}
                    </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 sticky top-4">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4 sm:mb-6">Order Summary</h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-700">
                  <span>Items Price</span>
                  <span>₹{subtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium">
                    <span>Discount</span>
                    <span>-₹{discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-700">
                  <span>Delivery</span>
                  <span className={shipping === 0 ? "text-emerald-600 font-medium" : ""}>
                    {shipping === 0 ? "FREE" : `₹${shipping.toFixed(2)}`}
                  </span>
                </div>
                <div className="border-t border-gray-300 pt-3 mt-3">
                  <div className="flex justify-between text-xl font-bold text-gray-900">
                    <span>Total</span>
                    <span>₹{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {error ? (
                <p className="mb-4 text-sm text-green-950/55">{error}</p>
              ) : null}

              {paymentStatus === "success" ? (
                <p className="mb-4 text-sm text-emerald-700">Payment successful. Redirecting…</p>
              ) : null}

              <Button
                variant="solid-sm"
                onClick={handlePayment}
                disabled={!isAuthenticated && !otpVerified}
                loading={loading || paymentStatus === "processing"}
                loadingText="Processing..."
                icon={!isAuthenticated && !otpVerified ? undefined : <CreditCard className="w-5 h-5" />}
              >
                {!isAuthenticated && !otpVerified ? "Verify Email to Pay" : `Pay ₹${total.toFixed(2)}`}
              </Button>

              <p className="text-xs text-gray-500 text-center mt-4">
                Secure payment powered by Razorpay
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
