"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Accessible name for the scroll region (e.g. "Shop by Plant Type"). */
  label: string;
};

/**
 * Both arrows, including the top margin that lines them up with the middle of
 * a tile's photo: the circle is square, so its height is the tile width (112px
 * from `sm`, 144px from `lg`), and half of that less half the 40px button is
 * 36px and 52px.
 */
const ARROW_CLASS = `
  mt-9 lg:mt-13
  hidden sm:flex shrink-0 h-10 w-10 items-center justify-center
  rounded-full border border-emerald-200 bg-white text-emerald-800
  shadow-sm transition
  hover:bg-emerald-50 hover:border-emerald-300
  disabled:pointer-events-none disabled:opacity-30
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
`;

/**
 * Single-row horizontal scroller with an arrow button on each side.
 *
 * Used on `/categories` for plant-type tiles. The arrows sit beside the row
 * rather than on top of it, so they never cover a tile, and they align with the
 * circular photos rather than the middle of the whole tile (which includes two
 * lines of label text underneath).
 *
 * Arrows are desktop-only: touch users swipe, and on a phone two 40px controls
 * would eat a tenth of the row. They stay in the layout but dim at either end
 * so the row does not shift when scrolling reaches a limit.
 */
export default function HorizontalScrollRow({ children, label }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    // 4px tolerance for sub-pixel rounding on some devices.
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const resize = new ResizeObserver(updateScrollState);
    resize.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resize.disconnect();
    };
  }, [updateScrollState, children]);

  const scrollByAmount = (direction: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    // Scroll roughly one viewport of tiles so the next set comes into view.
    const amount = Math.max(el.clientWidth * 0.75, 200);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  return (
    // `items-start` keeps the arrows from stretching to the row's full height,
    // so their own top margin decides the alignment.
    <div className="flex items-start gap-2 sm:gap-3">
      <button
        type="button"
        aria-label={`Scroll ${label} left`}
        disabled={!canScrollLeft}
        onClick={() => scrollByAmount(-1)}
        className={ARROW_CLASS}
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
      </button>

      <ul
        ref={listRef}
        aria-label={label}
        className="
          flex min-w-0 flex-1 flex-nowrap gap-3 sm:gap-4 overflow-x-auto pb-3
          snap-x snap-mandatory scroll-smooth scrollbar-hide
        "
      >
        {children}
      </ul>

      <button
        type="button"
        aria-label={`Scroll ${label} right`}
        disabled={!canScrollRight}
        onClick={() => scrollByAmount(1)}
        className={ARROW_CLASS}
      >
        <ChevronRight className="h-5 w-5" strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
