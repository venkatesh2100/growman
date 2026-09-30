import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import OptimizedImage from "../ui/OptimizedImage";

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
    <Link href={href} className="group block h-full w-full touch-manipulation">
      <article className="flex h-full items-center gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3.5 transition-colors group-hover:border-emerald-300">
        {subcategory.image ? (
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-emerald-50">
            <OptimizedImage src={subcategory.image} alt="" fill sizes="48px" className="object-cover" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold capitalize text-green-900 sm:text-[15px]">
            {subcategory.name}
          </h3>
          {productCount > 0 ? (
            <p className="mt-0.5 text-xs text-gray-500">
              {productCount} {productCount === 1 ? "plant" : "plants"}
            </p>
          ) : null}
        </div>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-emerald-700"
          aria-hidden
        />
      </article>
    </Link>
  );
}
