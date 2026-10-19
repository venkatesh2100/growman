"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { apiFetch, readApiError, readJson } from "../../lib/api";
import {
  ShoppingBag,
  Check,
  Loader2,
  Lock,
  LogIn,
  Navigation,
  ArrowRight,
  MapPin,
  User,
  ShieldCheck,
  FileText,
  Truck,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useCartStore } from "../../lib/store/cartStore";
import { useAuthStore } from "../../lib/store/authStore";
import {
  indianStates,
  getAllStateNames,
} from "../../lib/data/indianStatesCities";
import { getCurrentLocation } from "../../lib/utils/geolocation";
import { toast } from "../../lib/toast";
import { userMessage } from "../../lib/errors";
import { formatPrice } from "../../lib/format";
import { business } from "../../lib/seo/site";
import { FormField, FormSelect } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import ButtonLink from "../../components/ui/ButtonLink";
import { buttonClass } from "../../components/ui/buttonStyles";
import QuotationEnquiry, { type EnquiryLine } from "../bulk/QuotationEnquiry";
import {
  fetchDeliveryQuote,
  pickDeliveryOption,
  toOrderItems,
  type FulfillmentQuote,
} from "../../lib/fulfillment";

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

/** `/auth/me`, used to prefill the form for a signed-in shopper. */
type ProfileResponse = {
  name?: string;
  email?: string;
  phone?: string;
  address?: {
    line?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  } | null;
};

type CheckUserResponse = {
  exists?: boolean;
};

/** `/checkout/create-order` on success. */
type CreateOrderResponse = {
  /** Razorpay's order id, passed to their widget. */
  id?: string;
  /** Our own order id, shown to the customer. */
  orderId: number;
  /** Opaque handle that lets a guest read this order back. */
  publicToken?: string;
  amount: number;
};

/**
 * The 409/422 shape the server uses to refuse an order it has repriced or
 * cannot fulfil. `error` names the reason so checkout can explain the
 * specific problem instead of showing one generic failure.
 */
type CreateOrderRejection = {
  error?: string;
  reason?: string;
  quote?: FulfillmentQuote;
  /** Present on `out_of_stock`: the lines that could not be reserved. */
  items?: Array<{ productId?: number; name?: string; available?: number }>;
};

type VerifyEmailOtpResponse = {
  verificationToken?: string;
};

type CouponPreview = {
  code: string;
  discount: number;
  description?: string;
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

  // Delivery quoting. Coordinates are only present once the shopper has used
  // "Use my location"; without them the server falls back to the pincode,
  // which is less precise but always available.
  const [quote, setQuote] = useState<FulfillmentQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  // Guest email verification. The server will not create an order for a
  // guest without a proof token, so this is a required step rather than a
  // nicety — it stops an order being placed against someone else's address
  // and makes the confirmation email reach a mailbox the buyer controls.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null,
  );
  // The token is bound to one address, so changing the email invalidates it.
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  const subtotal = getSubtotal();
  // Coordinates alone are enough for the server to measure the distance, so
  // a shopper whose browser filled in a position but no address still gets
  // a quote.
  const hasDestination =
    /^[1-9]\d{5}$/.test(customerInfo.pincode) || coords !== null;
  // There is nothing to choose: the server's rules decide how the order
  // travels, and checkout just applies the fee that comes back.
  const deliveryOption = useMemo(() => pickDeliveryOption(quote), [quote]);
  const channel = deliveryOption?.channel ?? null;
  const deliveryFee = deliveryOption?.fee ?? 0;
  const discount = coupon?.discount ?? 0;
  // Never let a coupon drive the payable amount below zero; the server
  // caps it the same way and would reject a mismatch.
  const total = Math.max(0, subtotal + deliveryFee - discount);
  const itemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );

  const canPay = deliveryOption !== null;
  // A quoted address with no delivery available is outside the radius or
  // too large to send retail, which is a sales conversation, not a payment.
  const needsCustomQuote = quote !== null && deliveryOption === null;
  // When delivery can't be paid for here, the cart goes to the store as a
  // quotation request instead.
  const offersQuotation = !canPay && (needsCustomQuote || quoteError !== null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const enquiryLines = useMemo<EnquiryLine[]>(
    () =>
      cart.map((item) => ({
        key: item.id,
        productId: item.productId,
        sizeId: item.productSizeId ?? 0,
        itemCode: "",
        name: item.name,
        size: item.label ?? "",
        slug: "",
        category: "",
        price: item.price,
        image: item.image,
        quantity: item.quantity,
      })),
    [cart],
  );
  const setEnquiryQuantity = (key: string, quantity: number) => {
    const store = useCartStore.getState();
    if (quantity <= 0) store.removeItem(key);
    else store.updateQuantity(key, quantity);
  };

  useEffect(() => {
    setLoaded(true);
  }, []);

  // A cart signature rather than the array itself, so re-renders that leave
  // the contents unchanged don't trigger another quote.
  const cartSignature = useMemo(
    () =>
      cart
        .map(
          (item) =>
            `${item.productId}:${item.productSizeId ?? ""}:${item.quantity}`,
        )
        .join("|"),
    [cart],
  );

  const requestQuote = useCallback(
    async (signal: AbortSignal) => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const next = await fetchDeliveryQuote(
          cart,
          {
            pincode: customerInfo.pincode,
            latitude: coords?.lat,
            longitude: coords?.lng,
          },
          signal,
        );
        if (signal.aborted) return;
        setQuote(next);
      } catch (err) {
        if (
          signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setQuoteError(
          userMessage(err, "Couldn't check delivery for this address."),
        );
        setQuote(null);
      } finally {
        if (!signal.aborted) setQuoteLoading(false);
      }
    },
    [cart, coords, customerInfo.pincode],
  );

  // Re-quote when the cart, pincode or coordinates change. Debounced because
  // the pincode field fires on every keystroke.
  useEffect(() => {
    if (cart.length === 0 || !hasDestination) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => void requestQuote(controller.signal), 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // requestQuote closes over the cart array, which is a new reference on
    // every render; the signature and the fields it actually reads are the
    // real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature, customerInfo.pincode, coords]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadUserAddress();
    }
  }, [isAuthenticated]);

  // A coupon's discount depends on what is in the cart, so a cart edit
  // makes the applied figure stale. Dropping it is safer than showing a
  // discount the server will recompute and reject at order creation.
  useEffect(() => {
    setCoupon(null);
    setCouponError(null);
  }, [cartSignature]);

  const updateField = <K extends keyof CustomerInfo>(
    key: K,
    value: CustomerInfo[K],
  ) => {
    setCustomerInfo((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const loadUserAddress = async () => {
    try {
      const res = await apiFetch("/auth/me");
      if (!res.ok) return;
      const data = await readJson<ProfileResponse>(res);
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
            state.name
              .toLowerCase()
              .includes(locationData.state!.toLowerCase()) ||
            locationData
              .state!.toLowerCase()
              .includes(state.name.toLowerCase()),
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
      toast(
        locationData.pincode
          ? "Address filled from your location"
          : "Got your location — please fill in the address",
        "success",
      );

      // Coordinates let the server measure the real distance to the store
      // instead of approximating from the pincode.
      if (locationData.latitude && locationData.longitude) {
        setCoords({
          lat: locationData.latitude,
          lng: locationData.longitude,
        });
      }

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
      const msg = userMessage(
        err,
        "Couldn't find your location. Please enter your pincode.",
      );
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
        const data = await readJson<CheckUserResponse>(res);
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

  // A signed-in shopper's email is already verified on their account, so
  // only guests see the OTP step.
  const emailVerified =
    isAuthenticated ||
    (verificationToken !== null &&
      verifiedEmail === customerInfo.email.trim().toLowerCase());

  const handleSendEmailOtp = async () => {
    const email = customerInfo.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const msg = "Enter a valid email address first.";
      setError(msg);
      toast(msg, "error");
      return;
    }

    setOtpSending(true);
    setError(null);
    try {
      const res = await apiFetch("/checkout/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const msg = await readApiError(
          res,
          "We couldn't send the code. Please try again in a moment.",
        );
        setError(msg);
        toast(msg, "error");
        return;
      }
      setOtpSent(true);
      toast(`We sent a 6-digit code to ${email}`, "success");
    } catch {
      const msg = "We couldn't send the code. Please check your connection.";
      setError(msg);
      toast(msg, "error");
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    const email = customerInfo.email.trim();
    const code = otpCode.trim();
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setOtpVerifying(true);
    setError(null);
    try {
      const res = await apiFetch("/checkout/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp: code }),
      });
      if (!res.ok) {
        const msg = await readApiError(
          res,
          "That code didn't match. Please check it and try again.",
        );
        setError(msg);
        toast(msg, "error");
        return;
      }

      const data = await readJson<VerifyEmailOtpResponse>(res);
      if (!data.verificationToken) {
        // Verification without a token would leave the shopper stuck at
        // the payment step with no way to see why.
        const msg = "We couldn't confirm your email. Please request a new code.";
        setError(msg);
        toast(msg, "error");
        setOtpSent(false);
        return;
      }

      setVerificationToken(data.verificationToken);
      setVerifiedEmail(email.toLowerCase());
      setOtpCode("");
      toast("Email verified", "success");
    } catch {
      const msg = "We couldn't confirm your email. Please try again.";
      setError(msg);
      toast(msg, "error");
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;

    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await apiFetch("/checkout/validate-coupon", {
        method: "POST",
        body: JSON.stringify({
          code,
          items: toOrderItems(cart),
          subtotal,
          email: customerInfo.email.trim() || undefined,
        }),
      });

      if (!res.ok) {
        // The server owns coupon eligibility, so show its reason verbatim
        // rather than guessing at one here.
        setCouponError(
          await readApiError(res, "That code can't be used on this order."),
        );
        setCoupon(null);
        return;
      }

      const data = await readJson<CouponPreview>(res);
      setCoupon(data);
      toast(`Coupon ${data.code} applied`, "success");
    } catch {
      setCouponError("We couldn't check that code. Please try again.");
      setCoupon(null);
    } finally {
      setCouponChecking(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
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

    if (!channel) {
      const msg = needsCustomQuote
        ? "We can't deliver this order to that address at a fixed price. Request a quotation and we'll price it."
        : "Enter your pincode to check delivery.";
      setError(msg);
      toast(msg, "error");
      return;
    }

    if (!isAuthenticated) {
      const exists = await checkUserExists(
        customerInfo.email,
        customerInfo.phone,
      );
      if (exists) return;

      if (!emailVerified) {
        const msg = "Please verify your email address to place the order.";
        setError(msg);
        toast(msg, "error");
        // Surface the step rather than just complaining about it.
        if (!otpSent) void handleSendEmailOtp();
        return;
      }
    }

    setLoading(true);
    setError(null);
    setPaymentStatus("processing");

    try {
      const isLoaded = await loadRazorpay();
      if (!isLoaded) {
        setError("Payment couldn't start. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
        return;
      }

      const orderItems = toOrderItems(cart);

      if (orderItems.length === 0) {
        setError("Please add the items to your cart again.");
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
          fulfillmentChannel: channel,
          latitude: coords?.lat,
          longitude: coords?.lng,
          couponCode: coupon?.code,
          // Guests only; the server reads the signed-in user's verified
          // address from their account instead.
          verificationToken: verificationToken ?? undefined,
        }),
      });

      // The server re-derives the quote when it creates the order, so the
      // fee or the availability of a channel can have moved since the quote
      // shown here. It answers 409 with the current quote; adopt it and let
      // the shopper confirm the new figure rather than charging either
      // amount silently.
      if (orderRes.status === 409 || orderRes.status === 422) {
        const conflict = await readJson<CreateOrderRejection>(orderRes).catch(
          () => ({}) as CreateOrderRejection,
        );
        // Adopting the server's quote re-derives the delivery and the fee,
        // so the shopper only has to confirm the new total.
        if (conflict.quote) setQuote(conflict.quote);

        let msg: string;
        switch (conflict.error) {
          case "out_of_stock": {
            // Name the items. "Something is out of stock" sends the shopper
            // hunting through their own cart.
            const names = (conflict.items ?? [])
              .map((item) => item.name)
              .filter((name): name is string => Boolean(name));
            msg =
              names.length > 0
                ? `${names.join(", ")} just sold out. Please update your cart and try again.`
                : "One of your items just sold out. Please update your cart and try again.";
            break;
          }
          case "coupon_rejected":
            // The coupon is no longer valid for this order, so clear it
            // rather than leaving a discount on screen that won't apply.
            setCoupon(null);
            setCouponError(conflict.reason ?? "That code can't be used on this order.");
            msg = conflict.reason ?? "Your coupon is no longer valid for this order.";
            break;
          case "channel_unavailable":
            msg = "Delivery for this order has changed. Please check the total and pay again.";
            break;
          default:
            msg = "Delivery charges have changed. Please check the total and pay again.";
        }

        setError(msg);
        toast(msg, "error");
        setPaymentStatus("idle");
        setLoading(false);
        return;
      }

      // The guest's proof token expired or was already spent. Reset the
      // step so they can request a fresh code.
      if (orderRes.status === 403) {
        const rejection = await readJson<CreateOrderRejection>(orderRes).catch(
          () => ({}) as CreateOrderRejection,
        );
        if (rejection.error === "email_not_verified") {
          setVerificationToken(null);
          setVerifiedEmail(null);
          setOtpSent(false);
          const msg =
            "Your email confirmation expired. Please verify your email again.";
          setError(msg);
          toast(msg, "error");
          setPaymentStatus("idle");
          setLoading(false);
          return;
        }
      }

      if (!orderRes.ok) {
        const errorData = await readApiError(orderRes);
        console.error("Create order failed:", orderRes.status, errorData);
        throw new Error("create order failed");
      }

      const orderData = await readJson<CreateOrderResponse>(orderRes);
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
              const errorData = await readApiError(verifyRes);
              console.error("Payment verify failed:", verifyRes.status, errorData);
              throw new Error("payment verification failed");
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
              // The token is what lets the confirmation page read the order
              // back. Order ids are sequential, so the server no longer
              // serves an order by id alone to someone who isn't signed in.
              const params = new URLSearchParams({
                orderId: String(orderData.orderId),
              });
              if (orderData.publicToken) {
                params.set("token", orderData.publicToken);
              }
              router.push(`/order-success?${params.toString()}`);
            }, 1500);
          } catch {
            setError(
              "We couldn't confirm your payment. If money was taken, it will be refunded or your order will be confirmed shortly.",
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
      if (!Razorpay) throw new Error("payment script missing");

      const paymentObject = new Razorpay(options);
      paymentObject.on("payment.failed", function () {
        setError("Payment failed. Please try again.");
        setPaymentStatus("failed");
        setLoading(false);
      });
      paymentObject.open();
    } catch (err: unknown) {
      console.error("Checkout error:", err);
      const msg = userMessage(err, "Payment couldn't start. Please try again.");
      setError(msg);
      toast(msg, "error");
      setPaymentStatus("failed");
      setLoading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-emerald-100 bg-white p-8 text-center sm:p-10">
          <ShoppingBag className="mx-auto mb-4 h-10 w-10 text-gray-400" />
          <h1 className="mb-2 font-space text-xl font-semibold text-green-900 sm:text-2xl">
            Your cart is empty
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            Add plants to your cart to check out.
          </p>
          <ButtonLink href="/shop" className="w-full">
            Browse plants
          </ButtonLink>
        </div>
      </div>
    );
  }

  const payButton = (
    <Button
      variant="solid-sm"
      onClick={offersQuotation ? () => setEnquiryOpen(true) : handlePayment}
      loading={loading || paymentStatus === "processing"}
      loadingText="Opening payment…"
      icon={
        offersQuotation ? (
          <FileText className="h-4 w-4" />
        ) : (
          <Lock className="h-4 w-4" />
        )
      }
      disabled={paymentStatus === "success" || (!canPay && !offersQuotation)}
    >
      {paymentStatus === "success"
        ? "Payment received"
        : canPay
          ? `Pay ${formatPrice(total)}`
          : offersQuotation
            ? "Request a quotation"
            : "Enter your address to continue"}
    </Button>
  );

  // What the quote means for this order, shown under the address so the
  // shopper sees the effect of the pincode they just typed.
  let deliveryNote: ReactNode = null;
  if (hasDestination && quoteLoading && !quote) {
    deliveryNote = (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking delivery for this address…
      </p>
    );
  } else if (deliveryOption) {
    const days = quote?.estimatedDeliveryDays ?? 0;
    const freeGap = quote?.amountForFreeDelivery ?? 0;
    deliveryNote = (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50/70 px-3.5 py-3 text-sm">
        <Truck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-green-900">
            {deliveryOption.label} ·{" "}
            {deliveryFee > 0 ? formatPrice(deliveryFee) : "Free"}
          </p>
          {days > 0 ? (
            <p className="text-gray-600">
              Courier estimate: about {days} {days === 1 ? "day" : "days"}.
            </p>
          ) : null}
          {freeGap > 0 ? (
            <p className="text-gray-600">
              Add {formatPrice(freeGap)} more for free delivery.
            </p>
          ) : null}
          {quote?.storeVisitSuggested ? (
            <p className="text-gray-600">
              You are close to our nursery. To collect in person instead,
              choose store pickup from your{" "}
              <Link
                href="/cart"
                className="font-medium text-emerald-700 underline underline-offset-2"
              >
                cart
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>
    );
  } else if (needsCustomQuote) {
    deliveryNote = (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50/60 px-3.5 py-3 text-sm text-gray-700">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
        <p>
          We can&apos;t price delivery to{" "}
          {customerInfo.pincode || "this address"} automatically for this
          order. Send a quotation request and our team will call you with a
          delivery price.
        </p>
      </div>
    );
  } else if (quoteError) {
    deliveryNote = (
      <p className="rounded-xl bg-stone-50 px-3.5 py-3 text-sm text-green-950/70">
        {quoteError} You can send a quotation request, or{" "}
        <a
          href={`tel:${business.telephone}`}
          className="font-medium text-emerald-700 underline underline-offset-2"
        >
          call the nursery
        </a>
        .
      </p>
    );
  }

  // Top padding is set separately from the bottom so the `md:` step cannot
  // override the space kept clear for the mobile sticky pay bar.
  return (
    <div className="min-h-screen pt-5 pb-32 sm:pt-8 lg:pb-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <CheckoutSteps />

        <div className="mt-5 mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
              Checkout
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {itemCount} {itemCount === 1 ? "item" : "items"} · Pay by UPI,
              card, netbanking or wallet
            </p>
          </div>
          {isAuthenticated ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
              <Check className="h-3.5 w-3.5" />
              Details filled from your account
            </span>
          ) : (
            <Link
              href="/login?redirect=/checkout"
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900"
            >
              <LogIn className="h-4 w-4" />
              Have an account? Sign in
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
          {/* One card, two sections. Separate cards for contact, address and
              delivery pushed the total below the fold on every screen. */}
          <div>
            <div className="divide-y divide-emerald-50 rounded-2xl border border-emerald-100 bg-white">
              {/* Contact */}
              <section className="p-5 sm:p-6" aria-labelledby="contact-heading">
                <StepHeading id="contact-heading" number={1} icon={User}>
                  Contact details
                </StepHeading>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    size="sm"
                    label="Full name *"
                    type="text"
                    autoComplete="name"
                    value={customerInfo.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder="Your name"
                  />
                  <FormField
                    size="sm"
                    label="Mobile number *"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={customerInfo.phone}
                    onChange={(e) =>
                      updateField(
                        "phone",
                        e.target.value.replace(/\D/g, "").slice(0, 10),
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
                  />
                  <div className="sm:col-span-2">
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
                      hint="Your order confirmation is sent here."
                    />
                  </div>
                </div>
              </section>

              {/* Address */}
              <section className="p-5 sm:p-6" aria-labelledby="address-heading">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <StepHeading
                    id="address-heading"
                    number={2}
                    icon={MapPin}
                    className="mb-0"
                  >
                    Delivery address
                  </StepHeading>
                  <button
                    type="button"
                    onClick={handleLocateMe}
                    disabled={locating}
                    className="inline-flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-green-900 hover:bg-emerald-50/60 disabled:opacity-50"
                  >
                    {locating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Navigation className="h-3.5 w-3.5 text-emerald-700" />
                    )}
                    {locating ? "Locating…" : "Use my location"}
                  </button>
                </div>

                <div className="space-y-3">
                  <FormField
                    size="sm"
                    label="Street address *"
                    type="text"
                    autoComplete="street-address"
                    value={customerInfo.addressLine}
                    onChange={(e) => updateField("addressLine", e.target.value)}
                    placeholder="House / flat, building, street"
                  />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="500001"
                      maxLength={6}
                    />
                    <FormField
                      size="sm"
                      label="City *"
                      type="text"
                      autoComplete="address-level2"
                      value={customerInfo.city}
                      onChange={(e) => updateField("city", e.target.value)}
                      placeholder="City"
                    />
                    <div className="col-span-2 sm:col-span-1">
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
                    </div>
                  </div>
                  {deliveryNote}
                </div>
              </section>
            </div>
          </div>

          {/* Summary */}
          {/* The item list lives here rather than in a separate section on
              the left, so the cart and the total stay on screen together. */}
          <aside aria-labelledby="summary-heading">
            <div className="lg:sticky lg:top-24">
              <div className="rounded-2xl border border-emerald-100 bg-white">
                <div className="flex items-center justify-between border-b border-emerald-50 px-5 py-3.5">
                  <h2
                    id="summary-heading"
                    className="text-base font-semibold text-green-900"
                  >
                    Order summary
                  </h2>
                  <Link
                    href="/cart"
                    className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    Edit
                  </Link>
                </div>

                <ul className="max-h-60 divide-y divide-emerald-50 overflow-y-auto px-5">
                  {cart.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-3">
                      <div className="relative shrink-0">
                        <Image
                          src={item.image}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-lg object-cover ring-1 ring-emerald-100"
                          alt={item.name}
                        />
                        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-semibold text-white">
                          {item.quantity}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-green-900">
                          {item.name}
                        </p>
                        {item.label ? (
                          <p className="text-xs text-gray-500">{item.label}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-green-900">
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-2 border-t border-emerald-50 px-5 py-4 text-sm">
                  <div className="flex justify-between text-gray-700">
                    <dt>Subtotal</dt>
                    <dd>{formatPrice(subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <dt>Delivery</dt>
                    <dd>
                      {quoteLoading && !quote ? (
                        <span className="text-gray-400">Checking…</span>
                      ) : needsCustomQuote ? (
                        <span className="text-gray-500">On quotation</span>
                      ) : !deliveryOption ? (
                        <span className="text-gray-400">
                          {hasDestination ? "—" : "Enter pincode"}
                        </span>
                      ) : deliveryFee > 0 ? (
                        formatPrice(deliveryFee)
                      ) : (
                        <span className="font-medium text-emerald-700">
                          Free
                        </span>
                      )}
                    </dd>
                  </div>
                  {discount > 0 ? (
                    <div className="flex justify-between text-emerald-700">
                      <dt>
                        Discount
                        {coupon ? (
                          <span className="ml-1 text-xs text-gray-500">
                            ({coupon.code})
                          </span>
                        ) : null}
                      </dt>
                      <dd>−{formatPrice(discount)}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between border-t border-emerald-50 pt-3">
                    <dt className="font-semibold text-green-900">Total</dt>
                    <dd className="font-space text-xl font-semibold text-green-900">
                      {formatPrice(total)}
                    </dd>
                  </div>
                </dl>

                <div className="border-t border-emerald-50 px-5 py-4">
                  {coupon ? (
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-green-900">
                          {coupon.code} applied
                        </p>
                        {coupon.description ? (
                          <p className="truncate text-xs text-gray-600">
                            {coupon.description}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="ml-3 shrink-0 text-sm font-medium text-gray-600 underline hover:text-green-900"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <label
                        htmlFor="coupon"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Have a coupon?
                      </label>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          id="coupon"
                          type="text"
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value.toUpperCase());
                            if (couponError) setCouponError(null);
                          }}
                          placeholder="Enter code"
                          autoComplete="off"
                          spellCheck={false}
                          className="min-w-0 flex-1 rounded-lg border border-green-200 px-3 py-2 text-sm uppercase focus:border-green-500 focus:ring-2 focus:ring-green-300"
                        />
                        <button
                          type="button"
                          onClick={handleApplyCoupon}
                          disabled={couponChecking || !couponInput.trim()}
                          className="shrink-0 rounded-lg border border-green-200 px-4 py-2 text-sm font-medium text-green-900 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {couponChecking ? "Checking…" : "Apply"}
                        </button>
                      </div>
                      {couponError ? (
                        <p role="alert" className="mt-1.5 text-sm text-green-950/70">
                          {couponError}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Guests verify their email before paying. The server
                    requires the resulting token, so this step is not
                    skippable — see CreateCheckoutOrder. */}
                {!isAuthenticated ? (
                  <div className="border-t border-emerald-50 px-5 py-4">
                    {emailVerified ? (
                      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        Email verified
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-700">
                          Verify your email
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          We&rsquo;ll send your order confirmation and invoice
                          here.
                        </p>

                        {!otpSent ? (
                          <button
                            type="button"
                            onClick={handleSendEmailOtp}
                            disabled={otpSending || !customerInfo.email.trim()}
                            className="mt-2.5 w-full rounded-lg border border-green-200 px-4 py-2 text-sm font-medium text-green-900 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {otpSending ? "Sending…" : "Send verification code"}
                          </button>
                        ) : (
                          <>
                            <div className="mt-2.5 flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                value={otpCode}
                                onChange={(e) =>
                                  setOtpCode(
                                    e.target.value.replace(/\D/g, "").slice(0, 6),
                                  )
                                }
                                placeholder="6-digit code"
                                aria-label="Email verification code"
                                className="min-w-0 flex-1 rounded-lg border border-green-200 px-3 py-2 text-sm tracking-[0.2em] focus:border-green-500 focus:ring-2 focus:ring-green-300"
                              />
                              <button
                                type="button"
                                onClick={handleVerifyEmailOtp}
                                disabled={otpVerifying || otpCode.length !== 6}
                                className="shrink-0 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                              >
                                {otpVerifying ? "Verifying…" : "Verify"}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={handleSendEmailOtp}
                              disabled={otpSending}
                              className="mt-2 text-xs font-medium text-gray-600 underline hover:text-green-900 disabled:opacity-50"
                            >
                              {otpSending ? "Sending…" : "Resend code"}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : null}

                <div className="px-5 pb-5">
                  {error ? (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-green-950/70"
                    >
                      {error}
                    </div>
                  ) : null}

                  {paymentStatus === "success" ? (
                    <p className="mb-3 text-sm font-medium text-emerald-700">
                      Payment received. Taking you to your order…
                    </p>
                  ) : null}

                  <div className="hidden lg:block">{payButton}</div>

                  <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    Payments are processed securely by Razorpay. Growman does
                    not store your card details.
                  </p>
                </div>
              </div>

              {/* Outside the card: a wholesale quote is a way off this page,
                so it sits below the box rather than competing with the pay
                button. */}
              {!offersQuotation ? (
                <Link
                  href="/bulk"
                  className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                >
                  Ordering in bulk? Request a quotation
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky pay bar: keeps payment one tap away on small screens. */}
      <div className="safe-area-pb fixed inset-x-0 bottom-0 z-40 border-t border-emerald-100 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Total</p>
            <p className="font-space text-lg leading-tight font-semibold text-green-900">
              {formatPrice(total)}
            </p>
          </div>
          <div className="flex-1">{payButton}</div>
        </div>
      </div>

      {enquiryOpen ? (
        <QuotationEnquiry
          lines={enquiryLines}
          phone={business.telephone}
          onQuantityChange={setEnquiryQuantity}
          onClose={() => setEnquiryOpen(false)}
          onSent={() => {
            useCartStore.getState().clearCart();
            router.push("/");
          }}
          initialContact={{
            name: customerInfo.name,
            phone: customerInfo.phone,
            address: [
              customerInfo.addressLine,
              customerInfo.city,
              customerInfo.pincode,
            ]
              .filter(Boolean)
              .join(", "),
          }}
        />
      ) : null}

      {showLoginPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-prompt-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2
              id="login-prompt-title"
              className="font-space text-lg font-semibold text-green-900"
            >
              You already have an account
            </h2>
            <p className="mt-2 mb-5 text-sm text-gray-600">
              Sign in to use your saved address and see this order in your
              account. Or use a different email to continue as a guest.
            </p>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Link
                href={`/login?email=${encodeURIComponent(customerInfo.email)}&phone=${encodeURIComponent(customerInfo.phone)}&redirect=/checkout`}
                prefetch={false}
                className={buttonClass("primary", "md", "flex-1")}
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
              <button
                type="button"
                onClick={() => {
                  setShowLoginPrompt(false);
                  setError(null);
                }}
                className={buttonClass("secondary", "md")}
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

const STEPS = ["Cart", "Details", "Payment"] as const;

/** Where the shopper is in the purchase: the cart is done, payment is next. */
function CheckoutSteps() {
  return (
    <nav aria-label="Checkout progress">
      <ol className="flex items-center gap-2 text-xs font-medium sm:text-sm">
        {STEPS.map((step, index) => {
          const done = index === 0;
          const current = index === 1;
          return (
            <li key={step} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="h-px w-6 bg-emerald-200 sm:w-10" />
              ) : null}
              {done ? (
                <Link
                  href="/cart"
                  className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-900"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {step}
                </Link>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 ${current ? "text-green-900" : "text-gray-400"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                      current
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-emerald-200"
                    }`}
                  >
                    {index + 1}
                  </span>
                  {step}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepHeading({
  id,
  number,
  icon: Icon,
  className = "mb-4",
  children,
}: {
  id: string;
  number: number;
  icon: ComponentType<{ className?: string }>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className={`flex items-center gap-2.5 text-base font-semibold text-green-900 ${className}`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="sr-only">Step {number}: </span>
      {children}
    </h2>
  );
}
