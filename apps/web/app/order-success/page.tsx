"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { apiFetch, readJson } from "../../lib/api";
import { formatPrice } from "../../lib/format";
import { business } from "../../lib/seo/site";
import { useAuthStore } from "../../lib/store/authStore";
import ButtonLink from "../../components/ui/ButtonLink";
import Thumbnail from "../../components/ui/Thumbnail";

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
  imageUrl?: string;
}

interface Order {
  id: string | number;
  amount: number;
  subtotal?: number;
  deliveryFee?: number;
  status?: string;
  paymentStatus?: string;
  customerEmail?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  items?: OrderItem[];
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  // Checkout puts an opaque token in the URL for guests. Order ids are
  // sequential, so the server will not serve an order by id to anyone who
  // isn't the signed-in owner — the token is how a guest proves this
  // confirmation is theirs.
  const token = searchParams.get("token");
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));

  useEffect(() => {
    if (!orderId) return;
    const fetchOrder = async () => {
      try {
        const query = token
          ? `token=${encodeURIComponent(token)}`
          : `id=${encodeURIComponent(orderId)}`;
        const res = await apiFetch(`/order?${query}`);
        if (res.ok) setOrder(await readJson<Order>(res));
      } catch (error) {
        console.error("Error fetching order:", error);
      } finally {
        setLoading(false);
      }
    };
    void fetchOrder();
  }, [orderId, token]);

  if (loading) return <OrderSuccessFallback />;

  const paid =
    !order || order.paymentStatus === "paid" || order.status === "paid" || order.status === "confirmed";
  const items = order?.items ?? [];
  const address = order
    ? [order.addressLine, order.city, order.state, order.pincode].filter(Boolean).join(", ")
    : "";

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <div className="rounded-2xl border border-emerald-100 bg-white p-6 sm:p-8">
        <div className="flex items-start gap-4">
          {paid ? (
            <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-700" />
          ) : (
            <Clock className="h-9 w-9 shrink-0 text-amber-600" />
          )}
          <div>
            <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900">
              {paid ? "Order confirmed" : "Confirming your payment"}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {paid
                ? order?.customerEmail
                  ? `Thank you. A confirmation has been sent to ${order.customerEmail}.`
                  : "Thank you. A confirmation email is on its way."
                : "This can take a few minutes. If money was taken, your order will be confirmed or the amount refunded."}
            </p>
            {order ? (
              <p className="mt-2 text-sm text-gray-500">
                Order number <span className="font-medium text-green-900">#{order.id}</span>
              </p>
            ) : null}
          </div>
        </div>

        {items.length > 0 ? (
          <ul className="mt-6 divide-y divide-emerald-50 border-y border-emerald-50">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <Thumbnail
                  src={item.imageUrl}
                  size={48}
                  alt={item.name}
                  className="h-12 w-12 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-green-900">{item.name}</p>
                  <p className="text-xs text-gray-500">Qty {item.quantity}</p>
                </div>
                <p className="shrink-0 text-sm font-medium text-green-900">
                  {formatPrice(item.price * item.quantity)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {order ? (
          <dl className="mt-4 space-y-1.5 text-sm">
            {order.subtotal ? (
              <div className="flex justify-between text-gray-700">
                <dt>Subtotal</dt>
                <dd>{formatPrice(order.subtotal)}</dd>
              </div>
            ) : null}
            {order.subtotal ? (
              <div className="flex justify-between text-gray-700">
                <dt>Delivery</dt>
                <dd>{order.deliveryFee ? formatPrice(order.deliveryFee) : "Free"}</dd>
              </div>
            ) : null}
            <div className="flex justify-between pt-1 font-semibold text-green-900">
              <dt>Total paid</dt>
              <dd>{formatPrice(order.amount)}</dd>
            </div>
          </dl>
        ) : null}

        {address ? (
          <div className="mt-5 rounded-xl bg-emerald-50/60 px-4 py-3 text-sm">
            <p className="text-xs font-medium text-gray-500">Delivering to</p>
            <p className="mt-0.5 text-green-900">{address}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          {isAuthenticated ? (
            <ButtonLink href="/orders" className="sm:flex-1">
              Track this order
            </ButtonLink>
          ) : null}
          <ButtonLink
            href="/shop"
            tone={isAuthenticated ? "secondary" : "primary"}
            className="sm:flex-1"
          >
            Continue shopping
          </ButtonLink>
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-gray-500">
        Questions about your order?{" "}
        <a
          href={`mailto:${business.email}${order ? `?subject=${encodeURIComponent(`Order #${order.id}`)}` : ""}`}
          className="font-medium text-emerald-700 hover:text-emerald-900"
        >
          Email us
        </a>{" "}
        or{" "}
        <a
          href={`tel:${business.telephone}`}
          className="font-medium text-emerald-700 hover:text-emerald-900"
        >
          call the nursery
        </a>
        .
      </p>
    </main>
  );
}

function OrderSuccessFallback() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
    </main>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<OrderSuccessFallback />}>
      <OrderSuccessContent />
    </Suspense>
  );
}
