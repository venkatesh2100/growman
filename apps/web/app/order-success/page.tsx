"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Package, Home, ShoppingBag } from "lucide-react";
import { apiFetch } from "../../lib/api";

export default function OrderSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("orderId");
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) {
      fetchOrder();
    } else {
      setLoading(false);
    }
  }, [orderId]);

  const fetchOrder = async () => {
    try {
      const res = await apiFetch(`/order?id=${orderId}`);
      if (res.ok) {
        const data = await res.json();
        setOrder(data);
      }
    } catch (error) {
      console.error("Error fetching order:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-emerald-600" />
            </div>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Order Placed Successfully!
          </h1>
          <p className="text-gray-600 mb-6">
            Thank you for your purchase. Your order has been confirmed.
          </p>

          {order && (
            <div className="bg-gray-50 rounded-lg p-6 mb-6 text-left">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Order ID:</span>
                  <span className="font-semibold text-gray-900">#{order.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount:</span>
                  <span className="font-semibold text-gray-900">
                    ₹{order.amount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <span className="font-semibold text-emerald-600 capitalize">
                    {order.paymentStatus === "paid" || order.status === "paid" ? "Paid" : order.status || order.paymentStatus || "Pending"}
                  </span>
                </div>
                {order.razorpayPaymentId && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Payment ID:</span>
                    <span className="font-mono text-sm text-gray-900">
                      {order.razorpayPaymentId.slice(0, 20)}...
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push("/shop")}
              className="bg-emerald-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center"
            >
              <ShoppingBag className="w-5 h-5 mr-2" />
              Continue Shopping
            </button>
            <button
              onClick={() => router.push("/")}
              className="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors flex items-center justify-center"
            >
              <Home className="w-5 h-5 mr-2" />
              Go Home
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-center text-gray-600">
              <Package className="w-5 h-5 mr-2" />
              <p className="text-sm">
                You will receive an order confirmation email shortly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

