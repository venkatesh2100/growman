import Link from "next/link";
import { business } from "../../lib/seo/site";
import { getAllPosts } from "../../lib/seo/blog";

/**
 * Nursery and plant-care section.
 *
 * Every factual claim here is restricted to information already published on
 * /about and in the footer — theHyderabad nursery, the parent nursery name,
 * contact hours and the national service area. Nothing about delivery times,
 * guarantees or certifications is asserted.
 */
export default function NurserySection() {
  const posts = getAllPosts().slice(0, 3);

  return (
    <section className="bg-white py-8 sm:py-12 md:py-16" aria-labelledby="nursery-heading">
      <div className="container mx-auto grid gap-8 px-3 sm:px-4 lg:grid-cols-2">
        <div>
          <h2
            id="nursery-heading"
            className="text-2xl sm:text-3xl font-bold text-green-900 mb-3"
          >
            Grown at Our Nursery in Hyderabad
          </h2>
          <p className="text-sm sm:text-base leading-relaxed text-gray-700">
            Growman is backed by {business.parentOrganization} in{" "}
            {business.address.locality}, {business.address.region} — one of
            India&apos;s established plant-growing regions. Plants are selected
            at the nursery and shipped to customers across{" "}
            {business.areaServed}.
          </p>
          <p className="mt-3 text-sm sm:text-base leading-relaxed text-gray-700">
            If you are unsure which plant suits your balcony, terrace or
            office, our team is available from{" "}
            {business.openingHours.opens} to {business.openingHours.closes} IST.
          </p>
          <p className="mt-4">
            <Link
              href="/about"
              className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              More about Growman and our nursery →
            </Link>
          </p>
        </div>

        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-green-900 mb-3">
            Plant Care Guides
          </h2>
          <p className="text-sm sm:text-base text-gray-700">
            Practical guidance for growing plants in Indian conditions.
          </p>
          <ul className="mt-4 space-y-3">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="font-medium text-emerald-800 hover:underline"
                >
                  {post.title}
                </Link>
                <p className="mt-0.5 text-sm text-gray-600">
                  {post.description}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <Link
              href="/blog"
              className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              All plant care guides →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
