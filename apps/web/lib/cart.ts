import type { CartItem } from "./store/cartStore";

type CartLineSize = {
  id?: number | string;
  price: number;
  label: string;
  dimension?: string;
  images?: string[];
};

type CartLineProduct = {
  id: number | string;
  name: string;
  mrp?: number;
  imageUrl?: string;
};

/**
 * Build the payload `useCartStore().addItem` expects from a product + selected size.
 * Centralizes the id-coercion and image-fallback logic that used to be duplicated
 * at every "Add to cart" / "Buy now" call site.
 */
export function buildCartLine(
  product: CartLineProduct,
  size: CartLineSize,
  quantity: number = 1
): Omit<CartItem, "id"> {
  return {
    productId: typeof product.id === "number" ? product.id : Number(product.id),
    productSizeId:
      size.id === undefined
        ? undefined
        : typeof size.id === "number"
          ? size.id
          : Number(size.id),
    name: product.name,
    mrp: product.mrp,
    price: size.price,
    label: size.label,
    dimension: size.dimension,
    quantity,
    image: size.images?.[0] || product.imageUrl || "",
  };
}
