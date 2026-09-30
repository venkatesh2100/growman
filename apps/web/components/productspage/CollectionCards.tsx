import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import CollectionTileImage from "../hompage/CollectionTileImage";
import type { CollectionImage } from "../../lib/seo/catalog";

export type CollectionCard = {
  href: string;
  title: string;
  description?: string;
  productCount?: number;
  image: CollectionImage | null;
};

/**
 * Photo cards linking into filtered views of the catalog. The photo is
 * decorative: the title beneath it names the destination.
 */
export default function CollectionCards({
  cards,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  cards: CollectionCard[];
  columns?: string;
}) {
  return (
    <ul className={`grid grid-cols-2 gap-3 sm:gap-4 ${columns}`}>
      {cards.map((card) => (
        <li key={card.href}>
          <Link
            href={card.href}
            prefetch={false}
            className="group flex h-full flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white transition-colors hover:border-emerald-300"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-emerald-50">
              <CollectionTileImage
                urls={card.image?.urls ?? []}
                fallbackLabel={card.title}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 45vw, 360px"
              />
            </div>
            <div className="flex flex-1 flex-col p-3.5 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-green-900 sm:text-base">
                  {card.title}
                </h3>
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-emerald-700" />
              </div>
              {card.description ? (
                <p className="mt-1 hidden text-sm leading-snug text-gray-600 sm:block">
                  {card.description}
                </p>
              ) : null}
              {card.productCount ? (
                <p className="mt-auto pt-2 text-xs font-medium text-emerald-700">
                  {card.productCount} {card.productCount === 1 ? "plant" : "plants"}
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
