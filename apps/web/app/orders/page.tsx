"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, MapPin, Package, Truck } from "lucide-react";
import { apiFetch, readApiError, readJson } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { formatPrice } from "../../lib/format";
import { business } from "../../lib/seo/site";
import { toast } from "../../lib/toast";
import AccountShell from "../../components/account/AccountShell";
import CancelOrderDialog from "../../components/account/CancelOrderDialog";
import InvoiceDownloadButton from "../../components/account/InvoiceDownloadButton";
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
  courierService?: string;
  awbNumber?: string;
  trackingUrl?: string;
  shippedAt?: string;
  deliveredAt?: string;
  invoiceNumber?: string;
  cancelledAt?: string;
  cancelReason?: string;
  refundedAmount?: number;
  items: OrderItem[];
}

type OrdersResponse = Order[] | { data?: Order[] };

/**
 * POST /orders/{id}/cancel. `refund` is the refund that was opened, or the
 * string "pending_manual" when the automatic refund failed and the team will
 * process it by hand; either way the order itself is cancelled.
 */
type CancelResponse = {
  success?: boolean;
  status?: string;
  message?: string;
  refund?: string | { id?: number; amount?: number; status?: string };
};

const PROGRESS_STEPS = ["Confirmed", "Shipped", "Out for delivery", "Delivered"];

type Tone = "green" | "amber" | "stone" | "red";

const TONE_CLASS: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  stone: "bg-emerald-50 text-gray-600 ring-emerald-100",
  red: "bg-red-50 text-red-700 ring-red-200",
};

/**
 * The order's fulfilment stage: a label, a badge tone and a step in
 * PROGRESS_STEPS (-1 when closed).
 *
 * The shipment timestamps are read before `status`, because the courier
 * webhook writes them and `status` can be a scan behind.
 */
function orderState(order: Order): { label: string; tone: Tone; step: number } {
  const s = (order.status || "").toLowerCase();
  const p = (order.paymentStatus || "").toLowerCase();
  if (order.cancelledAt || s === "cancelled") {
    return { label: "Cancelled", tone: "stone", step: -1 };
  }
  if (s === "failed" || p === "failed") return { label: "Payment failed", tone: "red", step: -1 };
  if (order.deliveredAt || s === "delivered") return { label: "Delivered", tone: "green", step: 3 };
  if (s === "out_for_delivery") return { label: "Out for delivery", tone: "amber", step: 2 };
  if (order.shippedAt || order.awbNumber || s === "shipped") {
    return { label: "Shipped", tone: "amber", step: 1 };
  }
  if (s === "confirmed" || s === "paid" || p === "paid") {
    return { label: "Confirmed", tone: "green", step: 0 };
  }
  return { label: "Processing", tone: "stone", step: 0 };
}

const CANCELLABLE_STATUSES = new Set(["pending", "paid", "confirmed", "processing"]);

/**
 * Mirrors Order.IsCancellable() on the backend, so the button is only offered
 * where the request will be accepted. The server still has the last word: a
 * parcel can be dispatched between this page loading and the click.
 */
function isCancellable(order: Order): boolean {
  if (order.cancelledAt || order.awbNumber || order.shippedAt) return false;
  return CANCELLABLE_STATUSES.has((order.status || "").toLowerCase());
}

/** True when money has been taken and not yet returned, so cancelling refunds. */
function isRefundable(order: Order): boolean {
  return (
    (order.paymentStatus || "").toLowerCase() === "paid" &&
    (order.refundedAmount ?? 0) < order.amount
  );
}

const CANCEL_REASONS: Record<string, string> = {
  customer_cancelled: "Cancelled by you",
  damaged: "Plants were damaged",
  wrong_item: "Wrong item",
  out_of_stock: "Out of stock",
  delivery_failed: "Delivery could not be completed",
  other: "Not given",
};

/** The backend stores either one of its reason codes or free text from ops. */
function cancelReasonLabel(reason?: string): string {
  const key = (reason || "").trim();
  if (!key) return "";
  return CANCEL_REASONS[key] ?? key;
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
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    const loadOrders = async () => {
      try {
        // "settled", not "paid": a refunded order's payment_status is no
        // longer `paid`, and a cancelled order disappearing from your own
        // history is worse than seeing it marked refunded.
        const res = await apiFetch("/orders?page=1&pageSize=20&status=settled&scope=self");
        if (res.ok) {
          const data = await readJson<OrdersResponse>(res);
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

  /**
   * Re-reads one order so the row reflects what the server actually did —
   * cancelling does not return the updated order, and a refusal means our
   * copy is stale.
   */
  const refreshOrder = async (orderId: number): Promise<Order | null> => {
    try {
      const res = await apiFetch(`/order?id=${orderId}`);
      if (!res.ok) return null;
      const fresh = await readJson<Order>(res);
      setOrders((prev) => prev.map((o) => (o.id === fresh.id ? fresh : o)));
      return fresh;
    } catch {
      return null;
    }
  };

  const confirmCancel = async () => {
    const order = cancelTarget;
    if (!order || cancelling) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/cancel`, { method: "POST" });

      if (res.status === 409) {
        setCancelTarget(null);
        toast(
          await readApiError(
            res,
            "This order has already been dispatched, so it can no longer be cancelled."
          ),
          "error"
        );
        await refreshOrder(order.id);
        return;
      }
      if (!res.ok) {
        toast(
          await readApiError(res, "We could not cancel this order. Please try again."),
          "error"
        );
        return;
      }

      const body = await readJson<CancelResponse>(res);
      setCancelTarget(null);
      const fresh = await refreshOrder(order.id);
      if (!fresh) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, status: "cancelled", cancelledAt: new Date().toISOString() }
              : o
          )
        );
      }
      toast(body.message || "Order cancelled.", "success");
    } catch {
      toast(
        "We could not reach the nursery just now. Please check your connection and try again.",
        "error"
      );
    } finally {
      setCancelling(false);
    }
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
            const deliveredOn = parseDate(order.deliveredAt);
            const shippedOn = parseDate(order.shippedAt);
            const cancelledOn = parseDate(order.cancelledAt);
            const cancelled =
              Boolean(order.cancelledAt) || (order.status || "").toLowerCase() === "cancelled";
            const open = state.step >= 0 && state.step < 3;
            const overdue = open && eta !== null && eta.getTime() < Date.now();
            const refunded = order.refundedAmount ?? 0;
            const reason = cancelReasonLabel(order.cancelReason);
            const address = [order.addressLine, order.city, order.state, order.pincode]
              .filter(Boolean)
              .join(", ");

            let headline: string;
            if (state.step < 0) headline = state.label;
            else if (deliveredOn) headline = `Delivered on ${formatDate(deliveredOn)}`;
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

                  {cancelled ? (
                    <div className="mt-3 rounded-xl bg-emerald-50/60 px-3.5 py-3 text-sm text-gray-600">
                      <p>
                        {cancelledOn
                          ? `Cancelled on ${formatDate(cancelledOn)}. The plants have gone back into stock.`
                          : "This order was cancelled."}
                      </p>
                      {reason ? <p className="mt-1">Reason: {reason}</p> : null}
                      {refunded > 0 ? (
                        <p className="mt-1">
                          {formatPrice(refunded)} refunded to your original payment method.
                        </p>
                      ) : isRefundable(order) ? (
                        <p className="mt-1">
                          A refund of {formatPrice(order.amount)} has been requested. It takes
                          a few working days to reach your original payment method.
                        </p>
                      ) : null}
                    </div>
                  ) : order.awbNumber ? (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-emerald-50/60 px-3.5 py-2.5 text-sm text-gray-600">
                      <Truck className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                      <span>
                        {order.courierService
                          ? `Shipped with ${order.courierService}`
                          : "Shipped"}
                        {shippedOn ? ` on ${formatDate(shippedOn)}` : ""}. Tracking number{" "}
                        <span className="font-medium text-green-900">{order.awbNumber}</span>.
                      </span>
                      {order.trackingUrl ? (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Track parcel for order #${order.id}`}
                          className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-700 hover:text-emerald-900"
                        >
                          Track parcel
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
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
                  <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
                    {order.invoiceNumber ? (
                      <InvoiceDownloadButton
                        orderId={order.id}
                        invoiceNumber={order.invoiceNumber}
                      />
                    ) : null}
                    {isCancellable(order) ? (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(order)}
                        aria-label={`Cancel order #${order.id}`}
                        className="text-sm font-medium text-gray-600 transition-colors hover:text-red-700"
                      >
                        Cancel order
                      </button>
                    ) : null}
                    <a
                      href={`mailto:${business.email}?subject=${encodeURIComponent(`Order #${order.id}`)}`}
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                    >
                      Get help with this order
                      <ChevronRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cancelTarget ? (
        <CancelOrderDialog
          orderId={cancelTarget.id}
          amount={cancelTarget.amount}
          refundable={isRefundable(cancelTarget)}
          submitting={cancelling}
          onConfirm={() => void confirmCancel()}
          onClose={() => {
            if (!cancelling) setCancelTarget(null);
          }}
        />
      ) : null}
    </AccountShell>
  );
}
