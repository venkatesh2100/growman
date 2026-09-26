"use client";

import Image from "next/image";
import { useState } from "react";

type Props = {
  urls: string[];
  /** Shown when every candidate fails to load. */
  fallbackLabel: string;
  priority?: boolean;
};

/**
 * Circular collection photo that walks a list of candidate URLs.
 *
 * Some catalog image keys 404 in GCS. Rather than leaving a blank ring, we
 * try the next product photo in the same collection, and only fall back to a
 * letter placeholder once every candidate has failed.
 *
 * The first candidate is usually a tile-sized file from `public/collections`
 * (see `scripts/sync-collection-images.mjs`). Those are already the right
 * dimensions and format, so they skip the image optimizer entirely.
 */
export default function CollectionTileImage({
  urls,
  fallbackLabel,
  priority = false,
}: Props) {
  const [index, setIndex] = useState(0);
  const src = urls[index];

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center text-2xl font-semibold text-emerald-300"
      >
        {fallbackLabel.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      fill
      sizes="(max-width: 640px) 96px, (max-width: 1024px) 112px, 144px"
      unoptimized={src.startsWith("/")}
      priority={priority && index === 0}
      className="object-cover transition duration-300 group-hover:scale-105"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}
