"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function CartItems({ isOpen, onClose }: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [cart, setCart] = useState<any[]>([]);

  // Load cart from localStorage
  useEffect(() => {
    if (isOpen) {
      const stogreen = JSON.parse(localStorage.getItem("cart") || "[]");
      setCart(stogreen);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="fixed inset-0  z-50">
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-xl bg-green-200  p-6 shadow-xl rounded-b-xl animate-slideDown"
      >
        {/* Close Button */}
        <button
          className="absolute right-4 top-4  text-xl"
          onClick={onClose}
        >
          ✕
        </button>

        <h2 className="text-xl font-semibold mb-4">Added to your cart</h2>

        {/* Cart Items */}
        <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
          {cart.map((item, idx) => (
            <div key={idx} className="flex items-center gap-4">
              <img
                src={item.image}
                className="w-16 h-16 rounded object-cover"
                alt=""
              />
              <div>
                <p className="text-sm">{item.name}</p>
                <p className="text-gray-300">
                  {item.label} • Qty: {item.quantity}
                </p>
                <p className="text-green-400 font-medium">₹ {item.price}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Subtotal + Buttons */}
        <div className="mt-6 border-t border-gray-700 pt-4">
          <p className="text-right text-lg font-bold">Subtotal: ₹{subtotal}</p>

          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/cart"
              className="bg-green-700 py-3 rounded text-center hover:bg-green-800"
            >
              View Cart ({cart.length})
            </Link>

            <Link
              href="/checkout"
              prefetch={false}
              className="bg-green-600 py-3 rounded text-center hover:bg-green-700"
            >
              Checkout
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
