import { Suspense } from 'react';
import PlantsLoading from '../../components/loading';
import ShopProducts from './ShopProducts';
import HeroSlider from './HeroSlider';

// export const dynamic = 'force-dynamic';

export default function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <HeroSlider />

      <div className="max-w-7xl mx-auto pt-6 sm:pt-8 md:pt-10 px-3 sm:px-4">
        <Suspense fallback={<PlantsLoading />}>
          <ShopProducts searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}