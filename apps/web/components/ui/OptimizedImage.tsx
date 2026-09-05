"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type OptimizedImageProps = ImageProps & {
  /** Soft fade-in once the image is fully decoded (hides progressive JPEG paint). */
  fadeIn?: boolean;
};

/**
 * next/image wrapper that always goes through the optimizer (/_next/image)
 * and fades in after decode so progressive cloud originals don't paint top→bottom.
 */
export default function OptimizedImage({
  className = "",
  fadeIn = true,
  onLoad,
  alt,
  ...props
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(!fadeIn);

  return (
    <Image
      alt={alt}
      {...props}
      // Never bypass the optimizer for remote storage URLs.
      unoptimized={props.unoptimized ?? false}
      className={`${className} ${
        fadeIn
          ? `transition-opacity duration-300 ease-out ${loaded ? "opacity-100" : "opacity-0"}`
          : ""
      }`.trim()}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
    />
  );
}
