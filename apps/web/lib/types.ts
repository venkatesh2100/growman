export interface Base {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface Category extends Base {
  name: string;
  slug: string;
  description?: string;
}

export interface Subcategory extends Base {
  name: string;
  slug: string;
  description?: string;
  categoryId: number;
}

export interface Brand extends Base {
  name: string;
  slug: string;
}

export interface ProductSize extends Base {
  label: string;
  price: number;
  stock: number;
  productId: number;
  images?: string[];
  dimension?: string;
}

export interface Attribute extends Base {
  name: string;
  value: string;
  productId: number;
}

export interface Review extends Base {
  rating: number;
  comment: string;
  productId: number;
  userId: number;
  user?: User;
}

export interface Product extends Base {
  name: string;
  slug: string;
  description?: string;
  fullDescription?: string;
  shortDescription?: string;
  specifications?: string;
  price: number;
  currency: string;
  imageUrl?: string;
  status?: string;
  featured: boolean;
  tags?: string[];
  stock: number;
  categoryId: number;
  category: Category;
  subcategoryId?: number;
  subcategory?: Subcategory | null;
  brandId?: number;
  brand?: Brand | null;
  sizes: ProductSize[];
  attributes: Attribute[];
  reviews: Review[];
  mrp?: number;
  taxInfo?: string;
}
