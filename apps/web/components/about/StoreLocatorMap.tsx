"use client";

import { Store } from "lucide-react";

const HYDERABAD_STORE_URL = "https://maps.app.goo.gl/DUgWr7F8qkq79rDA7";

type StoreCity = { name: string; x: number; y: number; open: boolean };

const CITIES: StoreCity[] = [
  { name: "Pune", x: 0.18, y: 0.18, open: false },
  { name: "Hyderabad", x: 0.625, y: 0.313, open: true },
  { name: "Amaravati", x: 0.82, y: 0.413, open: false },
  { name: "Bengaluru", x: 0.539, y: 0.82, open: false },
  { name: "Chennai", x: 0.795, y: 0.807, open: false },
];

const HUB = CITIES.find((c) => c.open)!;

export default function StoreLocatorMap() {
  return (
    <section>
      <div className="mb-3">
        <h2 className="font-space text-xl font-semibold text-green-900">Visit us in person</h2>
        <p className="mt-0.5 text-sm text-gray-500">Our store, and where we&apos;re headed next</p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-[#DCEFE4] bg-[#F0F7F4]">
        <div className="relative aspect-[2/1] min-h-[200px] sm:min-h-[240px]">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(rgba(5,150,105,0.14) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {CITIES.filter((c) => !c.open).map((city) => (
              <line
                key={city.name}
                x1={city.x * 100}
                y1={city.y * 100}
                x2={HUB.x * 100}
                y2={HUB.y * 100}
                stroke="#059669"
                strokeOpacity={0.3}
                strokeWidth={0.4}
                strokeDasharray="1 4"
                strokeLinecap="round"
              />
            ))}
          </svg>

          {CITIES.map((city) =>
            city.open ? (
              <a
                key={city.name}
                href={HYDERABAD_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${city.x * 100}%`, top: `${city.y * 100}%` }}
              >
                <span className="relative flex h-8 w-8 items-center justify-center">
                  <span className="absolute h-8 w-8 animate-ping rounded-full bg-emerald-600/40" />
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 shadow-md">
                    <Store className="h-4 w-4 text-white" />
                  </span>
                </span>
                <span className="mt-1 rounded-full bg-green-950 px-2 py-0.5 text-[10px] font-bold text-white">
                  {city.name}
                </span>
              </a>
            ) : (
              <div
                key={city.name}
                className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${city.x * 100}%`, top: `${city.y * 100}%` }}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-emerald-600 bg-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                </span>
                <span className="mt-1 text-[10px] font-semibold text-emerald-800">{city.name}</span>
              </div>
            )
          )}
        </div>

        <div className="border-t border-[#DCEFE4] bg-white px-4 py-3">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
              Open now
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-emerald-600 bg-white" />
              Coming soon
            </span>
          </div>
          <a
            href={HYDERABAD_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            Get directions to Hyderabad →
          </a>
        </div>
      </div>
    </section>
  );
}
