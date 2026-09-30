'use client';
import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { StaticImageData } from "next/image";
import OptimizedImage from "../../../components/ui/OptimizedImage";

type ImageProps = string | StaticImageData;

export default function ImageGallery({
  images,
  alt,
}: {
  images: ImageProps[] | undefined;
  alt: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 50 });

  const safeImages = images ?? [];
  const hasImages = safeImages.length > 0;
  const index = currentIndex < safeImages.length ? currentIndex : 0;
  const mainImage = hasImages ? safeImages[index] : undefined;

  const handleThumbnailClick = useCallback((i: number) => {
    setCurrentIndex(i);
    setIsZoomed(false);
  }, []);

  const handlePrev = useCallback(() => {
    if (!hasImages) return;
    setCurrentIndex((prev) => (prev - 1 + safeImages.length) % safeImages.length);
    setIsZoomed(false);
  }, [hasImages, safeImages.length]);

  const handleNext = useCallback(() => {
    if (!hasImages) return;
    setCurrentIndex((prev) => (prev + 1) % safeImages.length);
    setIsZoomed(false);
  }, [hasImages, safeImages.length]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomed) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    setPosition({
      x: ((e.clientX - left) / width) * 100,
      y: ((e.clientY - top) / height) * 100,
    });
  };

  const toggleZoom = () => {
    setIsZoomed(!isZoomed);
    setPosition({ x: 50, y: 50 });
  };

  return (
    <div>
      <div
        className={`relative aspect-square overflow-hidden rounded-2xl border border-emerald-100 bg-white ${
          mainImage ? (isZoomed ? "cursor-zoom-out" : "cursor-zoom-in") : ""
        }`}
        onMouseMove={handleMouseMove}
        onClick={mainImage ? toggleZoom : undefined}
      >
        {mainImage ? (
          <OptimizedImage
            src={mainImage}
            alt={safeImages.length > 1 ? `${alt}, photo ${index + 1} of ${safeImages.length}` : alt}
            fill
            priority
            className="object-contain"
            style={{
              transformOrigin: `${position.x}% ${position.y}%`,
              transform: isZoomed ? 'scale(2)' : 'scale(1)',
              transition: 'transform 0.2s ease-out',
            }}
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No photo available
          </div>
        )}

        {mainImage ? (
          <span className="pointer-events-none absolute right-3 bottom-3 hidden rounded-full bg-white/90 p-2 text-gray-700 shadow-sm md:block">
            {isZoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
          </span>
        ) : null}

        {safeImages.length > 1 ? (
          <>
            <button
              type="button"
              className="absolute top-1/2 left-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm hover:bg-white"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="absolute top-1/2 right-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm hover:bg-white"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              aria-label="Next photo"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {safeImages.length > 1 ? (
        <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
          {safeImages.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleThumbnailClick(idx)}
              className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-white transition-colors ${
                index === idx ? "border-emerald-700" : "border-transparent opacity-80 hover:opacity-100"
              }`}
              aria-label={`Show photo ${idx + 1}`}
              aria-current={index === idx ? "true" : undefined}
            >
              <OptimizedImage src={img} alt="" fill className="object-cover" sizes="96px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
