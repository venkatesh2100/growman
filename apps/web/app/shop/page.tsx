import { Suspense } from 'react';
import PlantsLoading from '../../components/loading';
import ShopProducts from './ShopProducts';
import HeroSlider from './HeroSlider';

export default function ShopPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Slider Section */}
      <HeroSlider />

      {/* Shop Content Section */}
      <div className="max-w-7xl mx-auto pt-10 px-4">
        <Suspense fallback={<PlantsLoading />}>
          <ShopProducts />
        </Suspense>
      </div>
    </div>
  );
}