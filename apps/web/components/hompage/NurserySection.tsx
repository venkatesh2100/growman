import Link from "next/link";
import { business, openingHoursDisplay } from "../../lib/seo/site";
import { getAllPosts } from "../../lib/seo/blog";

/**
 * Nursery and plant-care section.
 *
 * Every factual claim here is restricted to information already published on
 * /about and in the footer — the Hyderabad nursery, the parent nursery name,
 * contact hours and the national service area. Nothing about delivery times,
 * guarantees or certifications is asserted.
 */
export default function NurserySection() {
  const posts = getAllPosts().slice(0, 3);

  return (
    <section className="py-12 sm:py-16" aria-labelledby="nursery-heading">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8">
        <div className="rounded-2xl border border-emerald-100 bg-white p-6 sm:p-8">
          <h2
            id="nursery-heading"
            className="font-space text-xl font-semibold tracking-tight text-green-900 sm:text-2xl"
          >
            Grown at our nursery in Hyderabad
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Growman is backed by {business.parentOrganization} in{" "}
            {business.address.locality}, {business.address.region}. Plants are selected at the
            nursery and shipped to customers across {business.areaServed}.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Not sure which plant suits your balcony, terrace or office? Our team is available{" "}
            {openingHoursDisplay.replace(/, all days$/, " every day")}.
          </p>
          <Link
            href="/about"
            className="mt-5 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-900"
          >
            About Growman and the nursery →
          </Link>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-6 sm:p-8">
          <h2 className="font-space text-xl font-semibold tracking-tight text-green-900 sm:text-2xl">
            Plant care guides
          </h2>
          <p className="mt-3 text-[15px] text-gray-600">
            Practical advice for growing plants in Indian conditions.
          </p>
          <ul className="mt-4 divide-y divide-emerald-50">
            {posts.map((post) => (
              <li key={post.slug} className="py-3">
                <Link
                  href={`/blog/${post.slug}`}
                  className="font-medium text-green-900 hover:text-emerald-800"
                >
                  {post.title}
                </Link>
                <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{post.description}</p>
              </li>
            ))}
          </ul>
          <Link
            href="/blog"
            className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-900"
          >
            All care guides →
          </Link>
        </div>
      </div>
    </section>
  );
}
