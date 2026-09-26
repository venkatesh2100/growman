import Image from "next/image";
import Link from "next/link";

/**
 * Homepage hero. A server component: the H1, copy and both calls to action
 * are real anchors in the initial HTML, so crawlers can read the headline and
 * follow the links without executing JavaScript.
 */
export default function HomeHero() {
  return (
    <section className="relative pt-24 pb-16 md:pt-28 md:pb-24 overflow-hidden">
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-r from-green-50 to-emerald-50"></div>
        <div className="absolute top-20 right-0 w-2/3 h-96 bg-green-200 rounded-l-full opacity-20"></div>
        <div className="absolute top-40 left-0 w-1/3 h-64 bg-emerald-300 rounded-r-full opacity-30"></div>
      </div>

    <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row items-center">
          <div className="md:w-1/2 mb-10 md:mb-0">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-green-900 leading-tight mb-4">
              <span className="block text-emerald-600">Growman</span>
              Buy Plants Online <br />
              in <span className="text-emerald-600">India</span>
            </h1>
            <p className="text-lg text-green-700 mb-8 max-w-lg">
              Indoor, outdoor, flowering, ornamental, fruit and medicinal
              plants — grown at our nursery in Hyderabad and
              delivered across India.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
              <Link
                href="/shop"
                className="px-8 py-3 bg-emerald-700 text-white rounded-full font-medium hover:bg-emerald-800 transition duration-300 shadow-lg hover:shadow-emerald-200 text-center"
              >
                Shop Plants
              </Link>
              <Link
                href="/bulk"
                className="px-8 py-3 bg-white text-emerald-700 border border-emerald-700 rounded-full font-medium hover:bg-emerald-50 transition duration-300 text-center"
              >
                Bulk Order
              </Link>
            </div>
          </div>


          {/* Explicit width: without it the column sizes to its images and
              reflows as they load. */}
          <div className="relative z-10 grid w-full grid-cols-2 gap-4 md:w-1/2">
            <div className=" p-4 rounded-2xl shadow-lg">
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
                className="rounded-xl w-full h-auto"
              />
              <Image
                src="/shape.png"
                alt=""
                aria-hidden="true"
                width={512}
                height={512}
                className="rounded-xl pl-10 md:hidden h-auto w-full"
              />

            </div>
            <div className="mt-10">
              <div className=" p-4 rounded-2xl shadow-lg mb-4">
                <Image
                  src="/more.avif"
                  alt="Small potted plant on a table"
                  width={900}
                  height={586}
                  sizes="(max-width: 768px) 45vw, 256px"
                  className="rounded-xl w-full h-28+ object-cover"
                />
              </div>
              <div className="p-4 rounded-2xl shadow-lg">
                <Image
                  src="/ti.jpg"
                  alt="Close-up of a green rosette succulent"
                  width={1920}
                  height={1508}
                  sizes="(max-width: 768px) 45vw, 256px"
                  className="rounded-xl w-full h-34 object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
