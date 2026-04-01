"use client";

import { useEffect, useState } from "react";
import {
  Package,
  CheckCircle,
  Truck,
  Clock,
  XCircle,
  MapPin,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";

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
  customerName?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  items: OrderItem[];
}

const STATUS_CONFIG: Record<
  string,
  {
    bg: string;
    text: string;
    border: string;
    icon: React.ReactNode;
    dot: string;
  }
> = {
  paid: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    dot: "bg-emerald-500",
  },
  created: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: <RefreshCw className="w-3.5 h-3.5" />,
    dot: "bg-amber-400",
  },
  pending: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: <Clock className="w-3.5 h-3.5" />,
    dot: "bg-amber-400",
  },
  failed: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
    dot: "bg-red-500",
  },
  cancelled: {
    bg: "bg-gray-100",
    text: "text-gray-600",
    border: "border-gray-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
    dot: "bg-gray-400",
  },
  shipped: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    icon: <Truck className="w-3.5 h-3.5" />,
    dot: "bg-blue-500",
  },
  delivered: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    dot: "bg-emerald-500",
  },
};

function getStatusDisplay(status: string, paymentStatus: string): string {
  if (paymentStatus === "paid" || status === "paid") return "Paid";
  if (paymentStatus === "failed" || status === "failed") return "Failed";
  if (paymentStatus === "created") return "Processing";
  const s = status || paymentStatus || "pending";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getStatusKey(status: string, paymentStatus: string): string {
  if (paymentStatus === "paid" || status === "paid") return "paid";
  if (paymentStatus === "failed" || status === "failed") return "failed";
  if (paymentStatus === "created") return "created";
  return (status || paymentStatus || "pending").toLowerCase();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const response = await apiFetch("/orders?page=1&pageSize=20");
      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : data.data || [];
        setOrders(list);
      }
    } catch (error) {
      console.error("Error loading orders", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (orderId: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] py-10">
        <div className="max-w-2xl mx-auto px-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-pulse"
            >
              <div className="p-5 flex justify-between items-start">
                <div className="space-y-2">
                  <div className="h-4 w-32 bg-gray-100 rounded" />
                  <div className="h-3 w-24 bg-gray-100 rounded" />
                </div>
                <div className="h-6 w-20 bg-gray-100 rounded-full" />
              </div>
              <div className="px-5 pb-4 space-y-3">
                {[1, 2].map((j) => (
                  <div key={j} className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-3/4 bg-gray-100 rounded" />
                      <div className="h-3 w-1/2 bg-gray-100 rounded" />
                    </div>
                    <div className="h-4 w-14 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
              <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-between">
                <div className="h-4 w-16 bg-gray-100 rounded" />
                <div className="h-5 w-20 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] py-10">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              My Orders
            </h1>
            {orders.length > 0 && (
              <p className="text-sm text-gray-500 mt-0.5">
                {orders.length} order{orders.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            Shop
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <Package className="w-8 h-8 text-gray-300" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-1.5">
              No orders yet
            </h2>
            <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
              Your order history will appear here once you make a purchase.
            </p>
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <ShoppingBag className="w-4 h-4" />
              Start Shopping
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const statusKey = getStatusKey(order.status, order.paymentStatus);
              const statusDisplay = getStatusDisplay(
                order.status,
                order.paymentStatus
              );
              const config =
                STATUS_CONFIG[statusKey] || STATUS_CONFIG["pending"];
              const isExpanded = expandedItems.has(order.id);
              const visibleItems =
                isExpanded ? order.items : order.items?.slice(0, 3);
              const hasMore = (order.items?.length || 0) > 3;

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-shadow hover:shadow-md"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between p-5 pb-4">
                    <div>
                      <p className="text-[15px] font-bold text-gray-900">
                        Order #{order.id}
                      </p>
                      {order.razorpayOrderId && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">
                          {order.razorpayOrderId}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${config.dot}`}
                      />
                      {statusDisplay}
                    </span>
                  </div>

                  {/* Items */}
                  {order.items?.length > 0 && (
                    <div className="px-5 pb-1">
                      <div className="divide-y divide-gray-50">
                        {visibleItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 py-3"
                          >
                            <img
                              src={
                                item.imageUrl ||
                                "https://via.placeholder.com/48"
                              }
                              alt={item.name}
                              className="w-12 h-12 rounded-xl object-cover bg-gray-100 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {item.name}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Qty: {item.quantity} &times; ₹
                                {item.price.toFixed(0)}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-gray-900 flex-shrink-0">
                              ₹{(item.price * item.quantity).toFixed(0)}
                            </p>
                          </div>
                        ))}
                      </div>

                      {hasMore && (
                        <button
                          onClick={() => toggleExpand(order.id)}
                          className="text-xs text-emerald-600 font-medium py-2 hover:text-emerald-700 transition-colors"
                        >
                          {isExpanded
                            ? "Show less"
                            : `+${order.items.length - 3} more item${order.items.length - 3 !== 1 ? "s" : ""}`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Delivery Address */}
                  {(order.addressLine || order.city) && (
                    <div className="mx-5 mb-3 px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {[
                          order.addressLine,
                          order.city,
                          order.state,
                          order.pincode,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50 border-t border-gray-100">
                    <span className="text-sm font-medium text-gray-500">
                      Total
                    </span>
                    <span className="text-lg font-bold text-emerald-600">
                      ₹{order.amount.toFixed(0)}
                    </span>
                  </div>

                  {/* View Details */}
                  <Link
                    href={`/order-success?orderId=${order.id}`}
                    className="flex items-center justify-center gap-1.5 py-3 border-t border-gray-100 text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-colors group"
                  >
                    View details
                    <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}