'use client';
import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { StaticImageData } from "next/image";
import OptimizedImage from "../../../components/ui/OptimizedImage";

type ImageProps = string | StaticImageData;

export default function ImageGallery({ images }: { images: ImageProps[] | undefined }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 50 });

  const safeImages = images ?? [];
  const hasImages = safeImages.length > 0;
  const mainImage = hasImages ? safeImages[currentIndex] : undefined;

  const handleThumbnailClick = useCallback((index: number) => {
    if (!hasImages) return;
    setCurrentIndex(index);
    setIsZoomed(false);
  }, [hasImages]);

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
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setPosition({ x, y });
  };

  const toggleZoom = () => {
    setIsZoomed(!isZoomed);
    setPosition({ x: 50, y: 50 });
  };

  return (
    <div className="relative">
      {/* Main Image */}
      <div
        className="relative aspect-square overflow-hidden rounded-lg mb-4 cursor-pointer bg-gray-50"
        onMouseMove={handleMouseMove}
        onClick={toggleZoom}
      >
        {mainImage ? (
          <OptimizedImage
            src={mainImage}
            alt="Main product"
            fill
            priority
            className="object-contain"
            style={{
              transformOrigin: `${position.x}% ${position.y}%`,
              transform: isZoomed ? 'scale(2)' : 'scale(1)',
              transition: 'transform 0.2s ease-out, opacity 0.3s ease-out',
            }}
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        ) : (
          <div className="relative aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
            <span className="text-gray-400">No images available</span>
          </div>
        )}

        <div className="absolute bottom-4 right-4 bg-white/80 rounded-full p-2 shadow-sm">
          {isZoomed ? (
            <ZoomOut size={20} className="text-gray-700" />
          ) : (
            <ZoomIn size={20} className="text-gray-700" />
          )}
        </div>
      </div>

      {/* Thumbnail Navigation */}
      <div className="relative">
        {safeImages.length > 1 && (
          <>
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5  rounded-full shadow-md p-1 z-10 hover:bg-gray-100 transition-colors"
              onClick={handlePrev}
              aria-label="Previous image"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-5  rounded-full shadow-md p-1 z-10 hover:bg-gray-100 transition-colors"
              onClick={handleNext}
              aria-label="Next image"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}

        <div className="grid grid-cols-4 gap-3">
          {safeImages.map((img, idx) => (
            <button
              key={idx}
              onClick={() => handleThumbnailClick(idx)}
              className={`relative aspect-square rounded-lg overflow-hidden bg-gray-50 transition-all border-2 ${currentIndex === idx
                ? 'border-green-500 scale-105'
                : 'border-transparent opacity-80 hover:opacity-100'
                }`}
              aria-label={`View image ${idx + 1}`}
            >
              <OptimizedImage
                src={img}
                alt={`Thumbnail ${idx}`}
                fill
                className="object-cover"
                sizes="100px"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
