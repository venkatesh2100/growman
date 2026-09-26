"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import {
  ShoppingBag,
  CreditCard,
  Loader2,
  LogIn,
  Navigation,
  ArrowLeft,
  MapPin,
  User,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import { indianStates, getAllStateNames } from "../../lib/data/indianStatesCities";
import { getCurrentLocation } from "../../lib/utils/geolocation";
import { toast } from "../../lib/toast";
import { FormField, FormSelect } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import StorePickupOption from "../../components/store/StorePickupOption";

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

const emptyCustomer: CustomerInfo = {
  name: "",
  email: "",
  phone: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
};

function validateCustomer(info: CustomerInfo): string | null {
  if (!info.name.trim()) return "Please enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim())) {
    return "Please enter a valid email address.";
  }
  if (!/^[6-9]\d{9}$/.test(info.phone)) {
    return "Enter a valid 10-digit Indian mobile number.";
  }
  if (!info.addressLine.trim()) return "Please enter your delivery address.";
  if (!info.state) return "Please select your state.";
  if (!info.city.trim()) return "Please enter your city.";
  if (!/^[1-9]\d{5}$/.test(info.pincode)) {
    return "Enter a valid 6-digit pincode.";
  }
  return null;
}

export default function CheckoutPage() {
  const router = useRouter();
  const cart = useCartStore((state) => state.items);
  const getSubtotal = useCartStore((state) => state.getSubtotal);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "processing" | "success" | "failed"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(emptyCustomer);

  const subtotal = getSubtotal();
  const total = subtotal;
  const itemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  useEffect(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadUserAddress();
    }
  }, [isAuthenticated]);

  const updateField = <K extends keyof CustomerInfo>(
    key: K,
    value: CustomerInfo[K]
  ) => {
    setCustomerInfo((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const loadUserAddress = async () => {
    try {
      const res = await apiFetch("/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCustomerInfo({
        name: data.name || "",
        email: data.email || "",
        phone: data.phone || "",
        addressLine: data.address?.line || "",
        city: data.address?.city || "",
        state: data.address?.state || "",
        pincode: data.address?.pincode || "",
        country: data.address?.country || "India",
      });
    } catch (err) {
      console.error("Error loading user address:", err);
    }
  };

  const handleLocateMe = async () => {
    setLocating(true);
    setError(null);
    try {
      const locationData = await getCurrentLocation();

      let matchedState = "";
      if (locationData.state) {
        const stateMatch = indianStates.find(
          (state) =>
            state.name.toLowerCase().includes(locationData.state!.toLowerCase()) ||
            locationData.state!.toLowerCase().includes(state.name.toLowerCase())
        );
        if (stateMatch) matchedState = stateMatch.name;
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
      toast("Address filled from your location", "success");

      if (isAuthenticated && locationData.latitude && locationData.longitude) {
        try {
          await apiFetch("/auth/save-location", {
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
        } catch {
          // Form is already filled — silent fail on persist.
        }
      }
    } catch (err: unknown) {
      const msg = `Could not get location: ${err instanceof Error ? err.message : "Unknown error"}`;
      setError(msg);
      toast(msg, "error");
    } finally {
      setLocating(false);
    }
  };

  const checkUserExists = async (email?: string, phone?: string) => {
    if (!email && !phone) return false;
    try {
      const params = new URLSearchParams();
      if (email) params.append("email", email);
      if (phone) params.append("phone", phone);

      const res = await apiFetch(`/auth/check-user?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists && !isAuthenticated) {
          setShowLoginPrompt(true);
          return true;
        }
      }
    } catch (err) {
      console.error("Error checking user:", err);
    }
    return false;
  };

  const loadRazorpay = () =>
    new Promise<boolean>((resolve) => {
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

  const handlePayment = async () => {
    if (cart.length === 0) {
      setError("Your cart is empty");
      return;
    }

    const validationError = validateCustomer(customerInfo);
    if (validationError) {
      setError(validationError);
      toast(validationError, "error");
      return;
    }

    if (!isAuthenticated) {
      const exists = await checkUserExists(
        customerInfo.email,
        customerInfo.phone
      );
      if (exists) return;
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

      const orderItems = cart
        .filter((item) => item.productId && item.productId > 0)
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
        const errorData = await orderRes.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || "Failed to create order"
        );
      }

      const orderData = await orderRes.json();
      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
        amount: orderData.amount,
        currency: "INR",
        name: "Growman",
        description: `Order #${orderData.orderId}`,
        order_id: orderData.id || "",
        handler: async function (response: RazorpayResponse) {
          try {
            const verifyRes = await apiFetch("/razorpay/verify", {
              method: "POST",
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              const errorData = await verifyRes
                .json()
                .catch(() => ({ error: "Unknown error" }));
              throw new Error(
                (errorData as { error?: string }).error ||
                  "Payment verification failed"
              );
            }

            setPaymentStatus("success");

            if (!isAuthenticated && customerInfo.email) {
              try {
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
              }
            }

            useCartStore.getState().clearCart();
            setTimeout(() => {
              router.push(`/order-success?orderId=${orderData.orderId}`);
            }, 1500);
          } catch (err: unknown) {
            setError(
              err instanceof Error ? err.message : "Payment verification failed"
            );
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
        theme: { color: "#059669" },
        modal: {
          ondismiss: function () {
            setLoading(false);
            setPaymentStatus("idle");
          },
        },
      };

      const Razorpay = (
        window as {
          Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
        }
      ).Razorpay;
      if (!Razorpay) throw new Error("Razorpay SDK not loaded");

      const paymentObject = new Razorpay(options);
      paymentObject.on("payment.failed", function () {
        setError("Payment failed. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
      });
      paymentObject.open();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(msg);
      toast(msg, "error");
      setPaymentStatus("failed");
      setLoading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FBF7]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen bg-[#F9FBF7] flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm p-8 sm:p-12 text-center max-w-md w-full">
          <ShoppingBag className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-gray-400 mb-4" />
          <h1 className="text-xl sm:text-2xl font-semibold text-green-900 mb-2">
            Your cart is empty
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mb-6">
            Add some plants to your cart before checking out.
          </p>
          <Button
            variant="solid-sm"
            onClick={() => router.push("/shop")}
            icon={<ShoppingBag className="w-4 h-4" />}
          >
            Continue Shopping
          </Button>
        </div>
      </div>
    );
  }

  const payButton = (
    <Button
      variant="solid-sm"
      onClick={handlePayment}
      loading={loading || paymentStatus === "processing"}
      loadingText="Opening payment…"
      icon={<CreditCard className="w-5 h-5" />}
      disabled={paymentStatus === "success"}
    >
      {paymentStatus === "success"
        ? "Payment successful"
        : `Pay ₹${total.toFixed(0)} securely`}
    </Button>
  );

  // Top padding is set separately from the bottom so the `md:` step cannot
  // override the space kept clear for the mobile sticky pay bar.
  return (
    <div className="min-h-screen bg-[#F9FBF7] pt-4 sm:pt-6 md:pt-8 pb-28 lg:pb-8">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6 md:mb-8">
          <div>
            <Link
              href="/cart"
              className="inline-flex items-center text-sm text-emerald-700 hover:text-emerald-800 font-medium mb-2 touch-manipulation"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to cart
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-green-900 flex items-center gap-2">
              <CreditCard className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600" />
              Checkout
            </h1>
            <p className="mt-1 text-sm text-emerald-800/70">
              {itemCount} {itemCount === 1 ? "item" : "items"} · Pay with UPI,
              card, netbanking or wallet
            </p>
          </div>
          {isAuthenticated ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              Signed in — details prefilled
            </div>
          ) : (
            <Link
              href="/login?redirect=/checkout"
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              <LogIn className="w-4 h-4" />
              Sign in for faster checkout
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Contact */}
            <section className="bg-white rounded-xl shadow-sm border border-emerald-900/5 p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-semibold text-green-900 mb-4 sm:mb-5 flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-600" />
                Contact
              </h2>
              <div className="space-y-3 sm:space-y-4">
                <FormField
                  size="sm"
                  label="Full name *"
                  type="text"
                  autoComplete="name"
                  value={customerInfo.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Your name"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <FormField
                    size="sm"
                    label="Email *"
                    type="email"
                    autoComplete="email"
                    value={customerInfo.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    onBlur={() => {
                      if (
                        customerInfo.email.includes("@") &&
                        !isAuthenticated
                      ) {
                        void checkUserExists(customerInfo.email, undefined);
                      }
                    }}
                    placeholder="you@example.com"
                    hint="Order updates go here"
                  />
                  <FormField
                    size="sm"
                    label="Mobile *"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={customerInfo.phone}
                    onChange={(e) =>
                      updateField(
                        "phone",
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    onBlur={() => {
                      if (
                        customerInfo.phone.length === 10 &&
                        !isAuthenticated
                      ) {
                        void checkUserExists(undefined, customerInfo.phone);
                      }
                    }}
                    placeholder="9876543210"
                    maxLength={10}
                    hint="10-digit Indian number"
                  />
                </div>
              </div>
            </section>

            {/* Delivery */}
            <section className="bg-white rounded-xl shadow-sm border border-emerald-900/5 p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3 mb-4 sm:mb-5">
                <h2 className="text-lg sm:text-xl font-semibold text-green-900 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                  Delivery address
                </h2>
                <button
                  type="button"
                  onClick={handleLocateMe}
                  disabled={locating}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 touch-manipulation"
                >
                  {locating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Navigation className="w-3.5 h-3.5" />
                  )}
                  {locating ? "Locating…" : "Use my location"}
                </button>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <FormField
                  size="sm"
                  label="Street address *"
                  type="text"
                  autoComplete="street-address"
                  value={customerInfo.addressLine}
                  onChange={(e) => updateField("addressLine", e.target.value)}
                  placeholder="House / flat, building, street"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <FormSelect
                    size="sm"
                    label="State *"
                    value={customerInfo.state}
                    onChange={(e) => updateField("state", e.target.value)}
                  >
                    <option value="">Select state</option>
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
                    autoComplete="address-level2"
                    value={customerInfo.city}
                    onChange={(e) => updateField("city", e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <FormField
                    size="sm"
                    label="Pincode *"
                    type="text"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={customerInfo.pincode}
                    onChange={(e) =>
                      updateField(
                        "pincode",
                        e.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    placeholder="500001"
                    maxLength={6}
                  />
                  <FormSelect
                    size="sm"
                    label="Country"
                    value={customerInfo.country}
                    onChange={(e) => updateField("country", e.target.value)}
                  >
                    <option value="India">India</option>
                  </FormSelect>
                </div>
              </div>
            </section>

            {/* Items */}
            <section className="bg-white rounded-xl shadow-sm border border-emerald-900/5 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-green-900">
                  Your plants
                </h2>
                <Link
                  href="/cart"
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Edit cart
                </Link>
              </div>
              <ul className="divide-y divide-emerald-900/5">
                {cart.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <Image
                      src={item.image}
                      width={64}
                      height={64}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover shrink-0 ring-1 ring-emerald-900/10"
                      alt={item.name}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-base font-medium text-green-900 line-clamp-1">
                        {item.name}
                      </p>
                      {item.label ? (
                        <p className="text-xs text-emerald-800/60">{item.label}</p>
                      ) : null}
                      <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
                        Qty {item.quantity}
                      </p>
                    </div>
                    <span className="text-sm sm:text-base font-semibold text-green-900 shrink-0">
                      ₹{(item.price * item.quantity).toFixed(0)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Summary */}
          <aside className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-emerald-900/5 p-4 sm:p-6 sticky top-4">
              <h2 className="text-lg sm:text-xl font-semibold text-green-900 mb-4 sm:mb-5">
                Order summary
              </h2>
              <div className="space-y-2.5 sm:space-y-3 mb-5">
                <div className="flex justify-between text-sm sm:text-base text-gray-700">
                  <span>Items ({itemCount})</span>
                  <span>₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm sm:text-base text-gray-700">
                  <span>Delivery</span>
                  <span className="text-emerald-600 font-medium">FREE</span>
                </div>
                <div className="border-t border-emerald-900/10 pt-3 mt-1">
                  <div className="flex justify-between text-lg sm:text-xl font-bold text-green-900">
                    <span>Total</span>
                    <span>₹{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </div>
              ) : null}

              {paymentStatus === "success" ? (
                <p className="mb-4 text-sm text-emerald-700 font-medium">
                  Payment successful. Redirecting…
                </p>
              ) : null}

              <div className="hidden lg:block">{payButton}</div>

              <ul className="mt-4 space-y-1.5 text-[11px] sm:text-xs text-gray-500">
                <li className="flex items-start gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" />
                  Encrypted checkout via Razorpay
                </li>
                <li>UPI · Cards · Netbanking · Wallets</li>
              </ul>

              {/* Same three routes as the cart: collect in store, call, or ask
                  for a bulk quotation. A shopper who stalls on the address form
                  should not have to go back to find them. */}
              <StorePickupOption className="mt-5" />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky pay bar — matches cart CTA pattern, keeps pay one tap away */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-emerald-900/10 bg-white/95 backdrop-blur px-3 py-3 safe-area-pb">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-lg font-bold text-green-900 leading-tight">
              ₹{total.toFixed(0)}
            </p>
          </div>
          <div className="flex-1">{payButton}</div>
        </div>
      </div>

      {showLoginPrompt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4">
          <div
            role="dialog"
            aria-labelledby="login-prompt-title"
            className="bg-white rounded-xl shadow-xl p-5 sm:p-6 max-w-md w-full"
          >
            <div className="flex items-center mb-3 gap-2">
              <LogIn className="w-5 h-5 text-emerald-600" />
              <h2
                id="login-prompt-title"
                className="text-lg sm:text-xl font-semibold text-green-900"
              >
                Account already exists
              </h2>
            </div>
            <p className="text-sm sm:text-base text-gray-600 mb-5">
              Sign in to use your saved address and finish checkout faster. Or
              use a different email to continue as a guest.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Link
                href={`/login?email=${encodeURIComponent(customerInfo.email)}&phone=${encodeURIComponent(customerInfo.phone)}&redirect=/checkout`}
                prefetch={false}
                className="flex-1 bg-emerald-600 text-white py-2.5 sm:py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base touch-manipulation"
              >
                <LogIn className="w-4 h-4" />
                Sign in
              </Link>
              <button
                type="button"
                onClick={() => {
                  setShowLoginPrompt(false);
                  setError(null);
                }}
                className="px-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm sm:text-base touch-manipulation"
              >
                Use another email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
