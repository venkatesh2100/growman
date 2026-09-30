import Image from "next/image";
import Link from "next/link";
import { CreditCard, Store, Truck } from "lucide-react";

const SERVICE_POINTS = [
  { icon: Truck, label: "Delivery across India" },
  { icon: Store, label: "Pickup in Hyderabad" },
  { icon: CreditCard, label: "Secure payment" },
];

/**
 * Homepage hero. A server component: the H1, copy and both calls to action
 * are real anchors in the initial HTML, so crawlers can read the headline and
 * follow the links without executing JavaScript.
 */
export default function HomeHero() {
  return (
    <section className="relative overflow-hidden pt-10 pb-16 md:pt-16 md:pb-24">
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <div className="absolute inset-0 bg-linear-to-r from-green-50 to-emerald-50" />
        <div className="absolute top-20 right-0 h-96 w-2/3 rounded-l-full bg-green-200 opacity-20" />
        <div className="absolute top-40 left-0 h-64 w-1/3 rounded-r-full bg-emerald-300 opacity-30" />
      </div>

      <div className="relative z-10 container mx-auto px-4">
        <div className="flex flex-col items-center md:flex-row">
          <div className="mb-10 md:mb-0 md:w-1/2">
            <p className="mb-3 text-sm font-semibold tracking-wide text-emerald-600 uppercase">
              Growman · Shiridi Sai Nursery
            </p>
            <h1 className="mb-4 text-4xl leading-tight font-bold text-green-900 md:text-5xl lg:text-6xl">
              Buy plants online <br />
              in <span className="text-emerald-600">India</span>
            </h1>
            <p className="mb-8 max-w-lg text-lg text-green-700">
              Indoor, outdoor, flowering, ornamental, fruit and medicinal plants, grown at our
              nursery in Hyderabad and delivered across India.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Link
                href="/shop"
                className="rounded-full bg-emerald-700 px-8 py-3 text-center font-medium text-white shadow-lg transition duration-300 hover:bg-emerald-800 hover:shadow-emerald-200"
              >
                Shop plants
              </Link>
              <Link
                href="/bulk"
                className="rounded-full border border-emerald-700 bg-white px-8 py-3 text-center font-medium text-emerald-700 transition duration-300 hover:bg-emerald-50"
              >
                Bulk orders
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-green-700">
              {SERVICE_POINTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {/* Explicit width: without it the column sizes to its images and
              reflows as they load. */}
          <div className="relative z-10 grid w-full grid-cols-2 gap-4 md:w-1/2">
            <div className="rounded-2xl p-4 shadow-lg">
              {/* Largest above-the-fold image: eagerly loaded as the LCP
                  candidate, with its true 774x1161 aspect ratio so the
                  reserved box matches the rendered image and nothing shifts. */}
              <Image
                src="/plant.avif"
                alt="Large Monstera plant in a pot"
                width={774}
                height={1161}
                sizes="(max-width: 768px) 45vw, 256px"
                priority
                fetchPriority="high"
                className="h-auto w-full rounded-xl"
              />
              <Image
                src="/shape.png"
                alt=""
                aria-hidden="true"
                width={512}
                height={512}
                className="h-auto w-full rounded-xl pl-10 md:hidden"
              />
            </div>
            <div className="mt-10">
              <div className="mb-4 rounded-2xl p-4 shadow-lg">
                <Image
                  src="/more.avif"
                  alt="Small potted plant on a table"
                  width={900}
                  height={586}
                  sizes="(max-width: 768px) 45vw, 256px"
                  className="h-28 w-full rounded-xl object-cover sm:h-36"
                />
              </div>
              <div className="rounded-2xl p-4 shadow-lg">
                <Image
                  src="/ti.jpg"
                  alt="Close-up of a green rosette succulent"
                  width={1920}
                  height={1508}
                  sizes="(max-width: 768px) 45vw, 256px"
                  className="h-34 w-full rounded-xl object-cover sm:h-44"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
