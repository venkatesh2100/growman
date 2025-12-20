"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { ShoppingBag, CreditCard, CheckCircle, XCircle, Loader2, Mail, LogIn } from "lucide-react";
import Link from "next/link";
import { useCartStore } from "../../lib/store/cartStore";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  label?: string;
  productId?: number;
  productSizeId?: number;
}

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const cart = useCartStore((state) => state.items);
  const getSubtotal = useCartStore((state) => state.getSubtotal);
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
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
    addressLine: "",
    city: "",
    state: "",
    pincode: "",
  });

  useEffect(() => {
    setLoaded(true);
  }, []);

  const subtotal = getSubtotal();
  // Tax calculation commented out for now (as per requirements)
  // const tax = subtotal * 0.18; // 18% GST
  const discount = 0; // Can be calculated from MRP vs price
  const shipping = subtotal > 500 ? 0 : 50;
  const total = subtotal - discount + shipping;

  // Load Razorpay Script
  const loadRazorpay = () => {
    return new Promise<boolean>((resolve) => {
      if ((window as any).Razorpay) {
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

  const validateForm = (): boolean => {
    if (!customerInfo.name.trim()) {
      setError("Please enter your name");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!customerInfo.email.trim() || !emailRegex.test(customerInfo.email)) {
      setError("Please enter a valid email address");
      return false;
    }
    const phoneRegex = /^[6-9][0-9]{9}$/;
    if (!customerInfo.phone.trim() || !phoneRegex.test(customerInfo.phone)) {
      setError("Please enter a valid 10-digit phone number starting with 6-9");
      return false;
    }
    if (!customerInfo.addressLine.trim()) {
      setError("Please enter your address line");
      return false;
    }
    if (!customerInfo.city.trim()) {
      setError("Please enter your city");
      return false;
    }
    if (!customerInfo.state.trim()) {
      setError("Please enter your state");
      return false;
    }
    const pincodeRegex = /^[1-9][0-9]{5}$/;
    if (!customerInfo.pincode.trim() || !pincodeRegex.test(customerInfo.pincode)) {
      setError("Please enter a valid 6-digit pincode");
      return false;
    }
    return true;
  };

  const handleSendOTP = async () => {
    if (!validateForm()) {
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
        const errorData = await res.json();
        if (errorData.error === "user_exists") {
          setShowLoginPrompt(true);
          setError("An account with this email already exists. Please login to continue.");
          return;
        }
        throw new Error(errorData.error || "Failed to send OTP");
      }

      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP. Please try again.");
    } finally {
      setSendingOtp(false);
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
      const res = await apiFetch("/checkout/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: customerInfo.email, otp }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Invalid OTP");
      }

      setOtpVerified(true);
    } catch (err: any) {
      setError(err.message || "Invalid OTP. Please try again.");
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handlePayment = async () => {
    if (!otpVerified) {
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

      const options: any = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: "INR",
        name: "Growman",
        description: `Order #${orderData.orderId}`,
        order_id: orderData.id,
        handler: async function (response: any) {
          try {
            setPaymentStatus("success");
            // Clear cart
            useCartStore.getState().clearCart();
            // Redirect to success page after 2 seconds
            setTimeout(() => {
              router.push(`/order-success?orderId=${orderData.orderId}`);
            }, 2000);
          } catch (err: any) {
            setError(err.message || "Payment verification failed");
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

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", function (response: any) {
        setError("Payment failed. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
      });
      paymentObject.open();
    } catch (err: any) {
      setError(err.message || "An error occurred. Please try again.");
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Order Summary */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Information Form */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
                <CreditCard className="w-5 h-5 mr-2 text-emerald-600" />
                Customer Information
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={customerInfo.name}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={customerInfo.email}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, email: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    value={customerInfo.phone}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="9876543210"
                    maxLength={10}
                  />
                  <p className="text-xs text-gray-500 mt-1">10 digits, starting with 6-9</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Address Line *
                  </label>
                  <input
                    type="text"
                    value={customerInfo.addressLine}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, addressLine: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="Street / House No"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      City *
                    </label>
                    <input
                      type="text"
                      value={customerInfo.city}
                      onChange={(e) =>
                        setCustomerInfo({ ...customerInfo, city: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      State *
                    </label>
                    <input
                      type="text"
                      value={customerInfo.state}
                      onChange={(e) =>
                        setCustomerInfo({ ...customerInfo, state: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="State"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Pincode *
                  </label>
                  <input
                    type="text"
                    value={customerInfo.pincode}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="123456"
                    maxLength={6}
                  />
                  <p className="text-xs text-gray-500 mt-1">6 digits, starting with 1-9</p>
                </div>
              </div>
            </div>

            {/* Email OTP Verification */}
            {!otpVerified && (
              <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-emerald-200">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                  <Mail className="w-5 h-5 mr-2 text-emerald-600" />
                  Verify Email
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  We'll send a verification code to your email to continue with payment.
                </p>
                {!otpSent ? (
                  <button
                    onClick={handleSendOTP}
                    disabled={sendingOtp || !customerInfo.email}
                    className="w-full bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {sendingOtp ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Sending OTP...
                      </>
                    ) : (
                      <>
                        <Mail className="w-5 h-5 mr-2" />
                        Send OTP to {customerInfo.email || "your email"}
                      </>
                    )}
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Enter 6-digit OTP
                      </label>
                      <input
                        type="text"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-center text-2xl tracking-widest"
                        placeholder="000000"
                        maxLength={6}
                      />
                    </div>
                    <button
                      onClick={handleVerifyOTP}
                      disabled={verifyingOtp || otp.length !== 6}
                      className="w-full bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
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
                      href={`/login?email=${encodeURIComponent(customerInfo.email)}&redirect=/checkout`}
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
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Order Items</h2>
              <div className="space-y-4">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg"
                  >
                    <img
                      src={item.image}
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
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm p-6 sticky top-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Order Summary</h2>
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

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center">
                  <XCircle className="w-5 h-5 text-red-600 mr-2" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {paymentStatus === "success" && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                  <p className="text-sm text-green-700">Payment successful! Redirecting...</p>
                </div>
              )}

              <button
                onClick={handlePayment}
                disabled={loading || paymentStatus === "processing" || !otpVerified}
                className="w-full bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading || paymentStatus === "processing" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : !otpVerified ? (
                  "Verify Email to Pay"
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pay ₹{total.toFixed(2)}
                  </>
                )}
              </button>

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
