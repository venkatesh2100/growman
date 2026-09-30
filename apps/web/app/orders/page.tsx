"use client";

import { useEffect, useState } from "react";
import { ChevronRight, MapPin, Package } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { formatPrice } from "../../lib/format";
import { business } from "../../lib/seo/site";
import AccountShell from "../../components/account/AccountShell";
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
  id: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  expectedDeliveryDate?: string;
  customerName?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  items: OrderItem[];
}

const PROGRESS_STEPS = ["Confirmed", "Shipped", "Out for delivery", "Delivered"];

type Tone = "green" | "amber" | "stone" | "red";

const TONE_CLASS: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  stone: "bg-emerald-50 text-gray-600 ring-emerald-100",
  red: "bg-red-50 text-red-700 ring-red-200",
};

/** The order's fulfilment stage: a label, a badge tone and a step in PROGRESS_STEPS (-1 when closed). */
function orderState(order: Order): { label: string; tone: Tone; step: number } {
  const s = (order.status || "").toLowerCase();
  const p = (order.paymentStatus || "").toLowerCase();
  if (s === "cancelled") return { label: "Cancelled", tone: "stone", step: -1 };
  if (s === "failed" || p === "failed") return { label: "Payment failed", tone: "red", step: -1 };
  if (s === "delivered") return { label: "Delivered", tone: "green", step: 3 };
  if (s === "out_for_delivery") return { label: "Out for delivery", tone: "amber", step: 2 };
  if (s === "shipped") return { label: "Shipped", tone: "amber", step: 1 };
  if (s === "confirmed" || s === "paid" || p === "paid") {
    return { label: "Confirmed", tone: "green", step: 0 };
  }
  return { label: "Processing", tone: "stone", step: 0 };
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function askForHelp(orderId: number) {
  window.dispatchEvent(
    new CustomEvent("growman:chatbot-prefill", {
      detail: {
        message: `My order #${orderId} is past its expected delivery date. Can you check on it?`,
      },
    })
  );
}

const MAX_VISIBLE_ITEMS = 3;

export default function OrdersPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isAuthenticated) return;
    const loadOrders = async () => {
      try {
        const res = await apiFetch("/orders?page=1&pageSize=20&status=paid&scope=self");
        if (res.ok) {
          const data = await res.json();
          setOrders(Array.isArray(data) ? data : data.data || []);
        }
      } catch (error) {
        console.error("Error loading orders", error);
      } finally {
        setLoading(false);
      }
    };
    void loadOrders();
  }, [isAuthenticated]);

  const toggleExpand = (orderId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  return (
    <AccountShell
      title="Orders"
      description={
        !loading && orders.length > 0
          ? `${orders.length} ${orders.length === 1 ? "order" : "orders"}`
          : "Track deliveries and review past purchases."
      }
    >
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-emerald-100 bg-white"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-white px-6 py-12 text-center">
          <Package className="mx-auto h-9 w-9 text-gray-300" />
          <h2 className="mt-4 text-base font-semibold text-green-900">No orders yet</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-gray-600">
            Orders you place while signed in will appear here.
          </p>
          <ButtonLink href="/shop" className="mt-6">
            Browse plants
          </ButtonLink>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => {
            const state = orderState(order);
            const items = order.items ?? [];
            const isExpanded = expanded.has(order.id);
            const visibleItems = isExpanded ? items : items.slice(0, MAX_VISIBLE_ITEMS);
            const hiddenCount = items.length - MAX_VISIBLE_ITEMS;
            const eta = parseDate(order.expectedDeliveryDate);
            const open = state.step >= 0 && state.step < 3;
            const overdue = open && eta !== null && eta.getTime() < Date.now();
            const address = [order.addressLine, order.city, order.state, order.pincode]
              .filter(Boolean)
              .join(", ");

            let headline: string;
            if (state.step < 0) headline = state.label;
            else if (state.step === 3) headline = "Delivered";
            else if (overdue) headline = "Running late";
            else if (eta) headline = `Arriving by ${formatDate(eta)}`;
            else headline = state.label;

            return (
              <li
                key={order.id}
                className="overflow-hidden rounded-2xl border border-emerald-100 bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-emerald-50 bg-emerald-50/60 px-5 py-3 text-xs text-gray-500">
                  <dl className="flex flex-wrap gap-x-6 gap-y-1">
                    <div>
                      <dt>Order placed</dt>
                      <dd className="font-medium text-gray-800">{formatDate(order.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd className="font-medium text-gray-800">{formatPrice(order.amount)}</dd>
                    </div>
                    <div>
                      <dt>Order</dt>
                      <dd className="font-medium text-gray-800">#{order.id}</dd>
                    </div>
                  </dl>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${TONE_CLASS[state.tone]}`}
                  >
                    {state.label}
                  </span>
                </div>

                <div className="px-5 pt-4">
                  <p className="text-base font-semibold text-green-900">{headline}</p>
                  {overdue ? (
                    <p className="mt-1 text-sm text-gray-600">
                      This order is past its expected delivery date of {formatDate(eta!)}.{" "}
                      <button
                        type="button"
                        onClick={() => askForHelp(order.id)}
                        className="font-medium text-emerald-700 underline underline-offset-2"
                      >
                        Ask Dootha
                      </button>{" "}
                      or{" "}
                      <a
                        href={`mailto:${business.email}?subject=${encodeURIComponent(`Order #${order.id}`)}`}
                        className="font-medium text-emerald-700 underline underline-offset-2"
                      >
                        email us
                      </a>{" "}
                      and we&apos;ll check on it.
                    </p>
                  ) : null}

                  {state.step >= 0 ? (
                    <ol
                      className="mt-3 grid grid-cols-4 gap-1.5"
                      aria-label={`Delivery progress: ${state.label}`}
                    >
                      {PROGRESS_STEPS.map((step, index) => (
                        <li key={step}>
                          <span
                            className={`block h-1.5 rounded-full ${
                              index <= state.step ? "bg-emerald-600" : "bg-emerald-100"
                            }`}
                          />
                          <span
                            className={`mt-1.5 block text-[11px] leading-tight sm:text-xs ${
                              index <= state.step ? "font-medium text-green-900" : "text-gray-400"
                            }`}
                          >
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>

                {items.length > 0 ? (
                  <div className="px-5 pt-2">
                    <ul className="divide-y divide-emerald-50">
                      {visibleItems.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 py-3">
                          <Thumbnail
                            src={item.imageUrl}
                            size={52}
                            alt={item.name}
                            className="h-13 w-13 rounded-xl"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-green-900">
                              {item.name}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {item.quantity} × {formatPrice(item.price)}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-medium text-green-900">
                            {formatPrice(item.price * item.quantity)}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {hiddenCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(order.id)}
                        className="pb-2 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        {isExpanded
                          ? "Show fewer items"
                          : `Show ${hiddenCount} more ${hiddenCount === 1 ? "item" : "items"}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-50 px-5 py-3">
                  {address ? (
                    <p className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-1">{address}</span>
                    </p>
                  ) : (
                    <span />
                  )}
                  <a
                    href={`mailto:${business.email}?subject=${encodeURIComponent(`Order #${order.id}`)}`}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    Get help with this order
                    <ChevronRight className="h-4 w-4" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AccountShell>
  );
}
