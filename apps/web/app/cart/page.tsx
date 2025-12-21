"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Plus, Minus, Trash2, ArrowRight } from "lucide-react";
import { useCartStore, CartItem } from "../../lib/store/cartStore";

export default function CartPage() {
  const router = useRouter();
  const cart = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const getSubtotal = useCartStore((state) => state.getSubtotal);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  const subtotal = getSubtotal();
  // Tax calculation commented out for now
  // const tax = subtotal * 0.18;
  const discount = 0; // Can be calculated from MRP vs price
  const shipping = subtotal > 500 ? 0 : 50;
  const total = subtotal - discount + shipping;

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 md:py-8">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 md:mb-8 gap-3 sm:gap-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center">
            <ShoppingBag className="w-6 h-6 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-emerald-600" />
            Your Cart
          </h1>
          {cart.length > 0 && (
            <button
              onClick={() => router.push("/shop")}
              className="text-sm sm:text-base text-emerald-600 hover:text-emerald-700 active:text-emerald-800 font-medium flex items-center touch-manipulation"
            >
              Continue Shopping
              <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-1" />
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 sm:p-12 text-center">
            <ShoppingBag className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-gray-400 mb-3 sm:mb-4" />
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
              Your cart is empty
            </h2>
            <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
              Looks like you haven't added any plants to your cart yet.
            </p>
            <button
              onClick={() => router.push("/shop")}
              className="bg-emerald-600 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-lg font-medium hover:bg-emerald-700 active:bg-emerald-800 transition-colors inline-flex items-center touch-manipulation text-sm sm:text-base"
            >
              Start Shopping
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 ml-2" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-3 sm:space-y-4">
              {cart.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl shadow-sm p-4 sm:p-6 flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center"
                >
                  <img
                    src={item.image}
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover flex-shrink-0"
                    alt={item.name}
                  />

                  <div className="flex-1 min-w-0 w-full sm:w-auto">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                      {item.name}
                    </h3>
                    {item.label && (
                      <p className="text-xs sm:text-sm text-gray-500 mt-0.5 sm:mt-1">{item.label}</p>
                    )}
                    <div className="mt-1.5 sm:mt-2 flex items-center gap-2">
                      <p className="text-sm sm:text-base text-emerald-600 font-semibold">
                        ₹{item.price.toFixed(2)}
                      </p>
                      {item.mrp && item.mrp > item.price && (
                        <p className="text-xs sm:text-sm text-gray-500 line-through">
                          ₹{item.mrp.toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-2 sm:gap-3 bg-gray-100 rounded-lg p-1.5 sm:p-2 w-full sm:w-auto justify-between sm:justify-start">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 active:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                      aria-label="Decrease quantity"
                      disabled={item.quantity <= 1}
                    >
                      <Minus className="w-4 h-4 text-gray-700" />
                    </button>
                    <span className="text-base sm:text-lg font-medium text-gray-900 w-8 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 active:bg-gray-300 transition-colors touch-manipulation"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-4 h-4 text-gray-700" />
                    </button>
                  </div>

                  {/* Price and Delete */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 w-full sm:w-auto">
                    <p className="text-base sm:text-lg font-bold text-gray-900">
                      ₹{(item.price * item.quantity).toFixed(2)}
                    </p>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-red-500 hover:text-red-700 active:text-red-800 p-1.5 sm:p-2 hover:bg-red-50 active:bg-red-100 rounded-lg transition-colors touch-manipulation"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 sticky top-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4 sm:mb-6">
                  Order Summary
                </h2>
                <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                  <div className="flex justify-between text-sm sm:text-base text-gray-700">
                    <span>Items Price</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm sm:text-base text-emerald-600 font-medium">
                      <span>Discount</span>
                      <span>-₹{discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm sm:text-base text-gray-700">
                    <span>Delivery</span>
                    <span className={shipping === 0 ? "text-emerald-600 font-medium" : ""}>
                      {shipping === 0 ? "FREE" : `₹${shipping.toFixed(2)}`}
                    </span>
                  </div>
                  {subtotal < 500 && (
                    <p className="text-xs sm:text-sm text-emerald-600 font-medium">
                      Add ₹{(500 - subtotal).toFixed(2)} more for free shipping!
                    </p>
                  )}
                  <div className="border-t border-gray-300 pt-2 sm:pt-3 mt-2 sm:mt-3">
                    <div className="flex justify-between text-lg sm:text-xl font-bold text-gray-900">
                      <span>Total</span>
                      <span>₹{total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => router.push("/checkout")}
                  className="w-full bg-emerald-600 text-white py-2.5 sm:py-3 rounded-lg font-semibold hover:bg-emerald-700 active:bg-emerald-800 transition-colors flex items-center justify-center text-sm sm:text-base touch-manipulation"
                >
                  Proceed to Checkout
                  <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 ml-2" />
                </button>

                <p className="text-[10px] sm:text-xs text-gray-500 text-center mt-3 sm:mt-4">
                  Secure checkout with Razorpay
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
