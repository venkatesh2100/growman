'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function HeroSlider() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      id: 1,
      title: "Flowering Plants",
      subtitle: "Add natural color to your space",
     image: "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=1200&h=600&fit=crop",
      cta: "View Flowers"
    },

    {
      id: 2,
      title: "Succulents & Cacti",
      subtitle: "Minimal care, maximum beauty",
      image: "https://images.unsplash.com/photo-1459156212016-c812468e2115?w=1200&h=600&fit=crop",
      cta: "Explore Collection"
    },
    {
      id: 3,
      title: "Indoor Plant Collection",
      subtitle: "Bring calm, freshness & life into your home",
      // image: "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=1200&h=600&fit=crop",
      image:'https://images.unsplash.com/photo-1604762524889-3e2fcc145683?w=1200&h=600&fit=crop',
      cta: "Shop Indoor Plants"
    },
    {
      id: 4,
      title: "Air Purifying Plants",
      subtitle: "Breathe better. Live greener.",
      image: "https://plus.unsplash.com/premium_photo-1679428402040-e3c93439ec13?w=1200&h=600&fit=crop",
      cta: "Shop Now"
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <div className="relative w-full h-[600px] overflow-hidden">
      {/* Slides */}
      <div
        className="flex h-full transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {slides.map((slide, index) => (
          <div key={slide.id} className="min-w-full h-full relative">
            {/* Optimised via next/image: this 600px-tall banner is the LCP
                element on /shop. Only the first slide is eager — the rest are
                off-screen. */}
            <Image
              src={slide.image}
              alt={slide.title}
              fill
              sizes="100vw"
              priority={index === 0}
              loading={index === 0 ? undefined : "lazy"}
              className="object-cover"
            />

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/20 flex items-center">
              <div className="max-w-4xl px-6 md:px-16 text-white">
                {/* Decorative carousel copy, not document structure: it sits
                    above the page's h1, so it must not be a heading. */}
                <p className="text-4xl md:text-6xl font-bold leading-tight mb-4">
                  {slide.title}
                </p>
                <p className="text-lg md:text-2xl text-gray-200 mb-8 max-w-2xl">
                  {slide.subtitle}
                </p>
                <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-full font-semibold transition-all shadow-lg">
                  {slide.cta}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={() =>
          setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length)
        }
        className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/50 p-3 rounded-full backdrop-blur-md transition"
      >
        <ChevronLeft className="w-6 h-6 text-white" />
      </button>

      <button
        onClick={() =>
          setCurrentSlide((prev) => (prev + 1) % slides.length)
        }
        className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/50 p-3 rounded-full backdrop-blur-md transition"
      >
        <ChevronRight className="w-6 h-6 text-white" />
      </button>

      {/* Dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentSlide(index)}
            className={`h-3 rounded-full transition-all ${
              currentSlide === index
                ? 'w-8 bg-emerald-500'
                : 'w-3 bg-white/50 hover:bg-white'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
