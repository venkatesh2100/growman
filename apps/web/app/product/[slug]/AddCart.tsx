"use client";

import { useState } from "react";
import { ShoppingCart, Heart, Zap } from "lucide-react";
import { Product, ProductSize } from "../../../lib/types";
import { useCartStore } from "../../../lib/store/cartStore";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "../../../lib/toast";

export default function AddToCart({
  product,
  selectedSize,
}: {
  product: Product;
  selectedSize: ProductSize;
}) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const handleAddToCart = () => {
    if (selectedSize.stock === 0) {
      toast("This item is out of stock", "error");
      return;
    }

    const imageUrl = selectedSize.images?.[0] || product.imageUrl || '';
    const qty = Math.min(quantity, selectedSize.stock);
    
    // Add to cart store
    addItem({
      productId: product.id,
      productSizeId: selectedSize.id,
      name: product.name,
      mrp: product.mrp,
      price: selectedSize.price,
      label: selectedSize.label,
      dimension: selectedSize.dimension,
      quantity: qty,
      image: imageUrl,
    });

    // Show toast notification
    toast(`${product.name} (${selectedSize.label}) added to cart!`);
  };

  const handleBuyNow = () => {
    if (selectedSize.stock === 0) {
      toast("This item is out of stock", "error");
      return;
    }
    
    // Add to cart first
    handleAddToCart();
    
    // Navigate to checkout
    setTimeout(() => {
      router.push('/checkout');
    }, 300);
  };

  return (
    <>
      <div className="space-y-4">
        {/* Quantity Selector */}
        <div className="flex items-center space-x-4">
          <span className="text-gray-700 font-medium">Quantity:</span>
          <div className="flex items-center border-2 border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={quantity <= 1}
            >
              -
            </button>
            <span className="px-6 py-2 font-semibold text-gray-900 min-w-12 text-center">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => Math.min(selectedSize.stock, q + 1))}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={quantity >= selectedSize.stock}
            >
              +
            </button>
          </div>
          <span className="text-sm text-gray-500">
            {selectedSize.stock} available
          </span>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleAddToCart}
            disabled={selectedSize.stock === 0}
            className={`flex items-center justify-center px-6 py-3 rounded-lg font-semibold transition-all ${
              selectedSize.stock === 0
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg"
            }`}
          >
            <ShoppingCart size={18} className="mr-2" />
            Add to Cart
          </button>

          <button
            onClick={handleBuyNow}
            disabled={selectedSize.stock === 0}
            className={`flex items-center justify-center px-6 py-3 rounded-lg font-semibold transition-all ${
              selectedSize.stock === 0
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-amber-500 hover:bg-amber-600 text-white shadow-md hover:shadow-lg"
            }`}
          >
            <Zap size={18} className="mr-2" />
            Buy Now
          </button>

          <button
            onClick={() => setIsWishlisted(!isWishlisted)}
            className={`p-3 border-2 rounded-lg transition-all transform hover:scale-105 active:scale-95 ${
              isWishlisted
                ? "bg-red-50 border-red-300 text-red-600"
                : "border-gray-200 hover:bg-gray-50 hover:border-gray-300"
            }`}
            aria-label="Add to wishlist"
          >
            <Heart size={24} className={isWishlisted ? "fill-red-500" : ""} />
          </button>
        </div>
      </div>

      {/* Login Popup */}
      <AnimatePresence>
        {showLoginPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-black/40 z-50"
            onClick={() => setShowLoginPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-semibold mb-3 text-center">
                Please Sign In to Continue
              </h2>
              <p className="text-gray-500 mb-6 text-center">
                You need to sign in to proceed with checkout.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push("/login")}
                  className="flex-1 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={() => setShowLoginPrompt(false)}
                  className="flex-1 px-5 py-2.5 border-2 border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
