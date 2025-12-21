import Link from 'next/link';
import Image from 'next/image';

interface CategoryCardProps {
  category: {
    id: number | string;
    name: string;
    slug: string;
    image?: string;
    products?: number;
  };
}

export default function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="block h-full touch-manipulation"
      aria-label={`Browse ${category.name} category`}
    >
      <div className="bg-white rounded-xl shadow-md overflow-hidden border border-green-100 hover:shadow-xl active:shadow-lg transition-shadow duration-200 group h-full flex flex-col">
        {/* Image container with gradient overlay */}
        <div className="relative h-40 sm:h-48 bg-gradient-to-br from-green-50 to-emerald-50 overflow-hidden">
          {category.image ? (
            <Image
              src={category.image}
              alt={category.name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105 will-change-transform"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              priority={false}
              unoptimized={true} // For external URLs that Next.js can't optimize
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
          {/* Category badge */}
          <span className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-white/90 text-emerald-700 text-[10px] sm:text-xs font-medium px-2 sm:px-2.5 py-0.5 rounded-full shadow-sm">
            {category.products || 0}+
          </span>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 flex-1 flex flex-col">
          <h3 className="text-base sm:text-lg font-semibold text-green-800 group-hover:text-emerald-600 active:text-emerald-700 transition-colors line-clamp-2">
            {category.name}
          </h3>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            {category.products || 0} varieties available
          </p>

          {/* CTA Button (appears on hover, always visible on mobile) */}
          <div className="mt-2 sm:mt-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
            <span className="inline-flex items-center text-emerald-600 text-xs sm:text-sm font-medium">
              Explore collection
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5 sm:h-4 sm:w-4 ml-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
