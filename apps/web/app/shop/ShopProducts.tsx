import ProductsDisplay from '../../components/productspage/ProductsDisplay';
import { fetchProductsData } from '../../lib/data';

export default async function ShopProducts() {
  const { productsBySize } = await fetchProductsData();
  return <ProductsDisplay products={productsBySize} title="Shop All Plants" />;
}

