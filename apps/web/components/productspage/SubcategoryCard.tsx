import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

interface SubcategoryCardProps {
  subcategory: {
    id: string;
    name: string;
    slug: string;
    products?: number;
    image?: string;
    category: {
      slug: string;
    };
  };
}

export default function SubcategoryCard({ subcategory }: SubcategoryCardProps) {
  const productCount = subcategory.products || 0;
  const href = `/categories/${subcategory.category.slug}/${subcategory.slug}`;

  return (
    <Link
      href={href}
      className="block h-full group touch-manipulation"
      aria-label={`Browse ${subcategory.name} subcategory`}
    >
      <div className="bg-white rounded-xl shadow-md overflow-hidden border border-green-100 hover:shadow-xl active:shadow-lg transition-shadow duration-200 h-full flex flex-col">
        {/* Image container with gradient overlay */}
        <div className="relative h-40 sm:h-48 bg-gradient-to-br from-green-50 to-emerald-50 overflow-hidden">
          {subcategory.image ? (
            <Image
              src={subcategory.image}
              alt={subcategory.name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105 will-change-transform"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-green-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10 sm:h-12 sm:w-12 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-green-900/10 to-emerald-900/5" />
          {/* Product count badge */}
          {productCount > 0 && (
            <span className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-white/90 text-emerald-700 text-[10px] sm:text-xs font-medium px-2 sm:px-2.5 py-0.5 rounded-full shadow-sm">
              {productCount}+
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 flex-1 flex flex-col">
          <h3 className="text-base sm:text-lg font-semibold text-green-800 group-hover:text-emerald-600 active:text-emerald-700 transition-colors line-clamp-2 mb-1">
            {subcategory.name}
          </h3>
          <p className="text-xs sm:text-sm text-gray-500 mb-2 sm:mb-3">
            {productCount > 0 
              ? `${productCount} ${productCount === 1 ? 'variety' : 'varieties'} available`
              : 'Coming soon'
            }
          </p>

          {/* CTA Button (appears on hover, always visible on mobile) */}
          <div className="mt-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
            <span className="inline-flex items-center text-emerald-600 text-xs sm:text-sm font-medium">
              Explore collection
              <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 ml-1" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

