// components/FilterSidebar.tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FiFilter, FiX, FiDollarSign, FiTag, FiCheck } from 'react-icons/fi';

interface FilterSidebarProps {
  filterOptions: {
    categories?: {
      id: number;
      name: string;
      slug: string;
      count?: number;
    }[];
    brands?: {
      id: number;
      name: string;
      slug: string;
    }[];
    tags?: string[];
    priceRange?: {
      min: number;
      max: number;
    };
  };
  searchParams?: {
    category?: string | string[];
    brand?: string | string[];
    tag?: string | string[];
    minPrice?: string;
    maxPrice?: string;
    [key: string]: any;
  };
}

export function FilterSidebar({ filterOptions, searchParams = {} }: FilterSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // State for all filter values
  const [filters, setFilters] = useState({
    categories: [] as string[],
    brands: [] as string[],
    tags: [] as string[],
    minPrice: filterOptions.priceRange?.min || 0,
    maxPrice: filterOptions.priceRange?.max || 1000,
  });

  // Initialize filters from URL params
  useEffect(() => {
    if (searchParams.category) {
      const categories = Array.isArray(searchParams.category)
        ? searchParams.category
        : [searchParams.category];
      setFilters(prev => ({ ...prev, categories }));
    }

    if (searchParams.brand) {
      const brands = Array.isArray(searchParams.brand)
        ? searchParams.brand
        : [searchParams.brand];
      setFilters(prev => ({ ...prev, brands }));
    }

    if (searchParams.tag) {
      const tags = Array.isArray(searchParams.tag)
        ? searchParams.tag
        : [searchParams.tag];
      setFilters(prev => ({ ...prev, tags }));
    }

    if (searchParams.minPrice) {
      setFilters(prev => ({ ...prev, minPrice: Number(searchParams.minPrice) }));
    }

    if (searchParams.maxPrice) {
      setFilters(prev => ({ ...prev, maxPrice: Number(searchParams.maxPrice) }));
    }
  }, [searchParams]);

  const applyFilters = () => {
    const params = new URLSearchParams();

    filters.categories.forEach(cat => params.append('category', cat));
    filters.brands.forEach(brand => params.append('brand', brand));
    filters.tags.forEach(tag => params.append('tag', tag));

    if (filters.minPrice !== filterOptions.priceRange?.min) {
      params.set('minPrice', filters.minPrice.toString());
    }

    if (filters.maxPrice !== filterOptions.priceRange?.max) {
      params.set('maxPrice', filters.maxPrice.toString());
    }

    router.push(`${pathname}?${params.toString()}`);
    setIsMobileOpen(false);
  };

  const resetFilters = () => {
    setFilters({
      categories: [],
      brands: [],
      tags: [],
      minPrice: filterOptions.priceRange?.min || 0,
      maxPrice: filterOptions.priceRange?.max || 1000,
    });
    router.push(pathname);
  };

  const isAnyFilterActive =
    filters.categories.length > 0 ||
    filters.brands.length > 0 ||
    filters.tags.length > 0 ||
    filters.minPrice !== filterOptions.priceRange?.min ||
    filters.maxPrice !== filterOptions.priceRange?.max;

  return (
    <>
      {/* Mobile filter button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 bg-green-600 text-white p-3 sm:p-3.5 rounded-full shadow-lg hover:bg-green-700 active:bg-green-800 active:scale-95 transition-all touch-manipulation"
        aria-label="Open filters"
      >
        <FiFilter size={20} className="sm:w-6 sm:h-6" />
        {isAnyFilterActive && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 sm:w-5 sm:h-5 text-[10px] sm:text-xs flex items-center justify-center">
            !
          </span>
        )}
      </button>

      {/* Filter sidebar */}
      <div className={`fixed inset-0 z-40 lg:static lg:z-auto transform ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 ease-in-out bg-white lg:bg-transparent`}>
        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 h-full lg:h-auto overflow-y-auto overscroll-contain">
          <div className="flex justify-between items-center mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-xl font-bold text-green-800 flex items-center">
              <FiFilter className="mr-2 w-5 h-5 sm:w-6 sm:h-6" /> Filters
            </h2>
            <div className="flex items-center gap-2">
              {isAnyFilterActive && (
                <button
                  onClick={resetFilters}
                  className="text-xs sm:text-sm text-red-600 hover:text-red-800 active:text-red-900 flex items-center touch-manipulation"
                >
                  <FiX className="mr-1 w-4 h-4" /> <span className="hidden sm:inline">Clear all</span><span className="sm:hidden">Clear</span>
                </button>
              )}
              <button
                onClick={() => setIsMobileOpen(false)}
                className="lg:hidden text-gray-500 hover:text-gray-700 active:text-gray-900 touch-manipulation p-1"
                aria-label="Close filters"
              >
                <FiX size={20} className="sm:w-6 sm:h-6" />
              </button>
            </div>
          </div>

          <div className="space-y-8">
            {filterOptions.categories && filterOptions.categories.length > 0 && (
              <FilterSection
                title="Categories"
                icon={<div className="bg-green-100 text-green-800 rounded-lg p-2"><FiTag /></div>}
                items={filterOptions.categories.map(c => ({
                  id: c.slug,
                  name: c.name,
                  count: c.count,
                  checked: filters.categories.includes(c.slug)
                }))}
                onChange={(id, checked) => {
                  setFilters(prev => ({
                    ...prev,
                    categories: checked
                      ? [...prev.categories, id]
                      : prev.categories.filter(c => c !== id)
                  }));
                }}
              />
            )}

            {filterOptions.brands && filterOptions.brands.length > 0 && (
              <FilterSection
                title="Brands"
                icon={<div className="bg-blue-100 text-blue-800 rounded-lg p-2"><FiTag /></div>}
                items={filterOptions.brands.map(b => ({
                  id: b.slug,
                  name: b.name,
                  checked: filters.brands.includes(b.slug)
                }))}
                onChange={(id, checked) => {
                  setFilters(prev => ({
                    ...prev,
                    brands: checked
                      ? [...prev.brands, id]
                      : prev.brands.filter(b => b !== id)
                  }));
                }}
              />
            )}

            {filterOptions.tags && filterOptions.tags.length > 0 && (
              <TagFilter
                tags={filterOptions.tags}
                selectedTags={filters.tags}
                onTagToggle={(tag) => {
                  setFilters(prev => ({
                    ...prev,
                    tags: prev.tags.includes(tag)
                      ? prev.tags.filter(t => t !== tag)
                      : [...prev.tags, tag]
                  }));
                }}
              />
            )}

            {filterOptions.priceRange && (
              <PriceFilter
                min={filterOptions.priceRange.min}
                max={filterOptions.priceRange.max}
                values={{ min: filters.minPrice, max: filters.maxPrice }}
                onChange={(min, max) => setFilters(prev => ({ ...prev, minPrice: min, maxPrice: max }))}
              />
            )}
          </div>

          <div className="mt-6 sm:mt-8 flex gap-2 sm:gap-3">
            <button
              onClick={applyFilters}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-lg shadow transition-all font-medium text-sm sm:text-base touch-manipulation active:scale-95"
            >
              Apply Filters
            </button>
            <button
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden py-3 px-4 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-700 rounded-lg font-medium text-sm sm:text-base touch-manipulation active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden transition-opacity duration-300"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </>
  );
}

// Sub-components with improved UI
function FilterSection({ title, icon, items, onChange }: {
  title: string;
  icon?: React.ReactNode;
  items: { id: string; name: string; count?: number; checked: boolean }[];
  onChange: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-white">
      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        {icon}
        <h3 className="font-medium text-gray-800 text-sm sm:text-base">{title}</h3>
      </div>
      <div className="space-y-2 sm:space-y-3 max-h-48 sm:max-h-60 overflow-y-auto pr-2 overscroll-contain">
        {items.map(item => (
          <div key={item.id} className="flex items-center">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                id={`filter-${item.id}`}
                checked={item.checked}
                onChange={(e) => onChange(item.id, e.target.checked)}
                className="sr-only"
              />
              <div className={`w-5 h-5 flex items-center justify-center rounded border ${item.checked
                  ? 'bg-green-500 border-green-500'
                  : 'bg-white border-gray-300'
                }`}>
                {item.checked && <FiCheck className="text-white w-4 h-4" />}
              </div>
            </div>
            <label
              htmlFor={`filter-${item.id}`}
              className="ml-2 sm:ml-3 text-xs sm:text-sm text-gray-700 flex items-center justify-between w-full cursor-pointer touch-manipulation"
            >
              <span className="truncate flex-1">{item.name}</span>
              {item.count !== undefined && (
                <span className="text-[10px] sm:text-xs bg-gray-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full ml-2 flex-shrink-0">
                  {item.count}
                </span>
              )}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagFilter({ tags, selectedTags, onTagToggle }: {
  tags: string[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-white">
      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        <div className="bg-purple-100 text-purple-800 rounded-lg p-1.5 sm:p-2">
          <FiTag className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <h3 className="font-medium text-gray-800 text-sm sm:text-base">Tags</h3>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {tags.map(tag => (
          <button
            key={tag}
            type="button"
            onClick={() => onTagToggle(tag)}
            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-full transition-all flex items-center touch-manipulation active:scale-95 ${selectedTags.includes(tag)
                ? 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300'
              }`}
          >
            {selectedTags.includes(tag) && <FiCheck className="mr-1 w-3 h-3 sm:w-4 sm:h-4" />}
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}

function PriceFilter({ min, max, values, onChange }: {
  min: number;
  max: number;
  values: { min: number; max: number };
  onChange: (min: number, max: number) => void;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-white">
      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        <div className="bg-yellow-100 text-yellow-800 rounded-lg p-1.5 sm:p-2">
          <FiDollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <h3 className="font-medium text-gray-800 text-sm sm:text-base">Price Range</h3>
      </div>

      <div className="mb-3 sm:mb-4">
        <div className="flex justify-between text-xs sm:text-sm text-gray-600 mb-2">
          <span>Min: ₹{min}</span>
          <span>Max: ₹{max}</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] sm:text-xs text-gray-500 mb-1 block">Min Price</label>
            <input
              type="number"
              value={values.min}
              onChange={(e) => onChange(Number(e.target.value), values.max)}
              min={min}
              max={max}
              className="w-full p-2 border border-gray-300 rounded-lg text-xs sm:text-sm touch-manipulation"
              placeholder="Min"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] sm:text-xs text-gray-500 mb-1 block">Max Price</label>
            <input
              type="number"
              value={values.max}
              onChange={(e) => onChange(values.min, Number(e.target.value))}
              min={min}
              max={max}
              className="w-full p-2 border border-gray-300 rounded-lg text-xs sm:text-sm touch-manipulation"
              placeholder="Max"
            />
          </div>
        </div>
      </div>

      <div className="relative pt-1">
        <input
          type="range"
          min={min}
          max={max}
          value={values.min}
          onChange={(e) => onChange(Number(e.target.value), values.max)}
          className="absolute w-full h-1 bg-gray-300 rounded appearance-none pointer-events-none"
          style={{ zIndex: 1 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={values.max}
          onChange={(e) => onChange(values.min, Number(e.target.value))}
          className="absolute w-full h-1 bg-gray-300 rounded appearance-none pointer-events-none"
        />
        <div className="relative h-1 bg-gray-300 rounded">
          <div
            className="absolute h-1 bg-green-500 rounded"
            style={{
              left: `${((values.min - min) / (max - min)) * 100}%`,
              width: `${((values.max - values.min) / (max - min)) * 100}%`
            }}
          ></div>
        </div>
      </div>
    </div>
  );
}
