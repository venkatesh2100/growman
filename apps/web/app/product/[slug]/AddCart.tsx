"use client";

import { useState } from "react";
import { ShoppingCart, Heart } from "lucide-react";
import { Product, ProductSize } from "../../../lib/types";
export default function AddToCart({
  product,
  selectedSize,
  onCartOpen
}: {
  product: Product;
  selectedSize: ProductSize;
  onCartOpen:()=>void,
}) {
  // const { data: session } = useSession();
  // console.log(selectedSize);
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const handleAddToCart = async () => {
    // Not signed in → use localStorage
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");

    // Check if the size already exists in cart
    const existingIndex = cart.findIndex(
      (item: { productId: number }) => item.productId === selectedSize.id
    );

    if (existingIndex > -1) {
      // Update quantity but do not exceed stock
      cart[existingIndex].quantity = Math.min(
        cart[existingIndex].quantity + quantity,
        selectedSize.stock
      );
    } else {
      cart.push({
        productId: selectedSize.id,
        name: product.name,
        mrp: product.mrp,
        price: selectedSize.price,
        label: selectedSize.label,
        dimension: selectedSize.dimension,
        quantity: Math.min(quantity, selectedSize.stock),
        image: selectedSize.images?.[0] || product.imageUrl || '',
      });
    }

    localStorage.setItem("cart", JSON.stringify(cart));
    onCartOpen?.();
    console.log("Added to local cart", cart);

    // // Signed in → send to DB
    // const res = await fetch("/api/cart", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     productId: product.id,
    //     sizeId: product.sizeId || 1, // optional
    //     quantity,
    //     price: product.price,
    //   }),
    // });

    // if (res.ok) {
    //   console.log("Added to DB cart");
    // } else {
    //   console.error("Failed to add to cart");
    // }
  };

  const handleBuyNow = () => {
    setShowLoginPrompt(true);
  };

  return (
    <>
      <div className="space-y-4">
        {/* Quantity Selector */}
        <div className="flex items-center space-x-4">
          <span className="text-gray-700">Quantity:</span>
          <div className="flex items-center border rounded-md">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="px-3 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              disabled={quantity <= 1}
            >
              -
            </button>
            <span className="px-4 py-1">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
              className="px-3 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              disabled={quantity >= product.stock}
            >
              +
            </button>
          </div>
          <span className="text-sm text-gray-500">
            {product.stock} available
          </span>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleAddToCart}
            disabled={product.stock === 0}
            className={`flex items-center justify-center px-6 py-3 rounded-md font-medium transition-colors ${
              product.stock === 0
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            <ShoppingCart size={18} className="mr-2" />
            Add to Cart
          </button>

          <button
            onClick={handleBuyNow}
            disabled={product.stock === 0}
            className={`px-6 py-3 rounded-md font-medium transition-colors ${
              product.stock === 0
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-yellow-500 hover:bg-yellow-600 text-white"
            }`}
          >
            Buy Now
          </button>

          <button
            onClick={() => setIsWishlisted(!isWishlisted)}
            className={`p-3 border rounded-md transition-colors ${
              isWishlisted
                ? "bg-red-50 border-red-200 text-red-500"
                : "hover:bg-gray-100"
            }`}
          >
            <Heart size={24} className={isWishlisted ? "fill-red-500" : ""} />
          </button>
        </div>
      </div>

      {/* Login Popup */}
      {showLoginPrompt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-full text-center">
            <h2 className="text-lg font-semibold mb-3">
              Please Sign In to Continue
            </h2>
            <p className="text-gray-500 mb-5">
              You need to sign in to proceed with checkout.
            </p>
            <button
              onClick={() => (window.location.href = "/signin")}
              className="px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Sign In
            </button>
            <button
              onClick={() => setShowLoginPrompt(false)}
              className="ml-3 px-5 py-2 border rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
