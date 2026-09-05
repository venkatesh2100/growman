import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import OptimizedImage from "../ui/OptimizedImage";

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
  const count = category.products ?? 0;
  const thumb = category.image || "/growman.png";

  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group block h-full w-full touch-manipulation"
      aria-label={`Browse ${category.name}`}
    >
      <article
        className="
          relative flex h-full min-h-[7.25rem] flex-col justify-between overflow-hidden
          rounded-2xl border border-emerald-800/10
          bg-[linear-gradient(160deg,rgba(255,255,255,0.72)_0%,rgba(236,253,245,0.55)_100%)]
          px-4 py-3.5
          transition-[transform,background-color,border-color,box-shadow] duration-200
          hover:border-emerald-700/20
          hover:bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(209,250,229,0.55)_100%)]
          hover:shadow-[0_10px_24px_rgba(6,95,70,0.08)]
          active:scale-[0.99]
        "
      >
        <div className="flex items-start justify-between gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md shadow-sm ring-1 ring-emerald-800/10 sm:h-14 sm:w-14">
            <OptimizedImage
              src={thumb}
              alt=""
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
          <span
            className="
              inline-flex h-7 w-7 items-center justify-center rounded-full
              text-emerald-700/70
              transition-all group-hover:bg-emerald-600 group-hover:text-white
            "
            aria-hidden
          >
            <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>

        <div className="mt-4 min-w-0">
          <h3 className="font-space truncate text-base font-semibold tracking-tight text-green-900 transition-colors group-hover:text-emerald-800">
            {category.name}
          </h3>
          <p className="mt-0.5 text-xs text-emerald-800/50">
            {count > 0
              ? `${count} ${count === 1 ? "variety" : "varieties"}`
              : "Explore collection"}
          </p>
        </div>
      </article>
    </Link>
  );
}
