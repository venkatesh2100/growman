"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, PenLine, Star } from "lucide-react";
import { apiFetch, readApiError, readJson } from "../../../lib/api";
import { useAuthStore } from "../../../lib/store/authStore";
import { Button } from "../../../components/ui/Button";
import ButtonLink from "../../../components/ui/ButtonLink";
import { toast } from "../../../lib/toast";
import {
  REVIEWS_PAGE_SIZE,
  productReviewsPath,
  ratingDistribution,
  totalApprovedReviews,
  type CreateReviewResponse,
  type ProductReview,
  type ProductReviewsResponse,
  type RatingBucket,
} from "../../../lib/reviews";
import ReviewForm from "./ReviewForm";

type Summary = {
  ratingAverage: number;
  ratingCount: number;
  histogram: RatingBucket[] | null;
};

const emptySummary: Summary = { ratingAverage: 0, ratingCount: 0, histogram: null };

function toSummary(data: ProductReviewsResponse): Summary {
  return {
    ratingAverage: Number(data.ratingAverage) || 0,
    ratingCount: Number(data.ratingCount) || 0,
    histogram: data.histogram,
  };
}

function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stars({ rating, className = "h-4 w-4" }: { rating: number; className?: string }) {
  return (
    <span className="flex" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={`${className} ${
            value <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-gray-300"
          }`}
        />
      ))}
    </span>
  );
}

function ReviewBody({ review }: { review: ProductReview }) {
  return (
    <>
      {review.title ? (
        <p className="mt-2 text-sm font-semibold text-green-900">{review.title}</p>
      ) : null}
      {review.comment ? (
        <p className="mt-1 text-sm leading-relaxed text-gray-700">{review.comment}</p>
      ) : null}
    </>
  );
}

export default function ProductReviews({
  productSlug,
  initialReviews,
}: {
  productSlug: string;
  initialReviews: ProductReviewsResponse | null;
}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [mounted, setMounted] = useState(false);
  const [summary, setSummary] = useState<Summary>(
    initialReviews ? toSummary(initialReviews) : emptySummary
  );
  const [reviews, setReviews] = useState<ProductReview[]>(initialReviews?.reviews ?? []);
  const [exhausted, setExhausted] = useState(
    (initialReviews?.reviews.length ?? REVIEWS_PAGE_SIZE) < REVIEWS_PAGE_SIZE
  );
  const [loading, setLoading] = useState(initialReviews === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [submitted, setSubmitted] = useState<CreateReviewResponse | null>(null);

  useEffect(() => setMounted(true), []);

  const loadPage = useCallback(
    async (offset: number): Promise<ProductReviewsResponse> => {
      const res = await apiFetch(productReviewsPath(productSlug, REVIEWS_PAGE_SIZE, offset));
      if (!res.ok) {
        throw new Error(await readApiError(res, "Could not load reviews."));
      }
      return readJson<ProductReviewsResponse>(res);
    },
    [productSlug]
  );

  const applyFirstPage = useCallback((page: ProductReviewsResponse) => {
    setSummary(toSummary(page));
    setReviews(page.reviews);
    setExhausted(page.reviews.length < REVIEWS_PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (initialReviews !== null) return;

    let active = true;
    const load = async () => {
      try {
        const page = await loadPage(0);
        if (!active) return;
        applyFirstPage(page);
        setLoadError(null);
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Could not load reviews.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();

    return () => {
      active = false;
    };
  }, [initialReviews, loadPage, applyFirstPage]);

  const showMore = async () => {
    setLoadingMore(true);
    try {
      const page = await loadPage(reviews.length);
      setSummary(toSummary(page));
      setReviews((prev) => {
        const seen = new Set(prev.map((review) => review.id));
        return [...prev, ...page.reviews.filter((review) => !seen.has(review.id))];
      });
      setExhausted(page.reviews.length < REVIEWS_PAGE_SIZE);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load more reviews.", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSubmitted = async (result: CreateReviewResponse) => {
    setSubmitted(result);
    setFormOpen(false);

    if (result.status !== "approved") {
      toast("Review received. It will appear once approved.", "success");
      return;
    }

    toast("Your review is published.", "success");
    try {
      applyFirstPage(await loadPage(0));
    } catch {
      // The confirmation panel below still shows the review that was saved.
    }
  };

  const total = totalApprovedReviews(summary);
  const distribution = ratingDistribution(summary.histogram);
  const hasMore = !exhausted && reviews.length < total;
  const average = summary.ratingAverage;
  const loginHref = `/login?redirect=${encodeURIComponent(`/product/${productSlug}#reviews`)}`;

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="mt-12 scroll-mt-28 rounded-2xl border border-emerald-100 bg-white px-5 py-6 sm:px-6"
    >
      <h2
        id="reviews-heading"
        className="font-space text-lg font-semibold tracking-tight text-green-900"
      >
        Customer reviews
      </h2>

      {loading ? (
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-emerald-50/70" />
          ))}
        </div>
      ) : loadError ? (
        <p className="mt-3 text-sm text-gray-600">{loadError}</p>
      ) : total === 0 ? (
        <p className="mt-3 text-sm text-gray-600">
          This plant has no reviews yet. If you have bought it, yours would be the first.
        </p>
      ) : (
        <div className="mt-4 max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-4">
              <p className="font-space text-4xl font-semibold text-green-900">
                {average.toFixed(1)}
                <span className="sr-only"> out of 5</span>
              </p>
              <div>
                <Stars rating={average} className="h-5 w-5" />
                <p className="mt-1 text-sm text-gray-500">
                  Based on {total} {total === 1 ? "review" : "reviews"}
                </p>
              </div>
            </div>

            <ul aria-label="Rating breakdown" className="min-w-[240px] flex-1 space-y-1.5">
              {distribution.map(({ rating, count }) => {
                const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <li key={rating} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="w-14 shrink-0">
                      {rating} {rating === 1 ? "star" : "stars"}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-2 flex-1 overflow-hidden rounded-full bg-emerald-50"
                    >
                      <span
                        className="block h-full rounded-full bg-amber-400"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums">
                      {count} ({percent}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {reviews.length > 0 ? (
            <ul className="mt-6 divide-y divide-emerald-50 border-t border-emerald-50">
              {reviews.map((review) => {
                const date = formatReviewDate(review.createdAt);
                return (
                  <li key={review.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Stars rating={review.rating} />
                      <span className="sr-only">{review.rating} out of 5</span>
                      <span className="text-sm font-medium text-green-900">{review.author}</span>
                      {review.verifiedPurchase ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Verified purchase
                        </span>
                      ) : null}
                      {date ? <span className="text-xs text-gray-500">{date}</span> : null}
                    </div>
                    <ReviewBody review={review} />
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasMore ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={showMore}
              loading={loadingMore}
              loadingText="Loading..."
            >
              Show more reviews
            </Button>
          ) : null}
        </div>
      )}

      <div className="mt-6 max-w-3xl border-t border-emerald-50 pt-5">
        {submitted ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-4">
            <h3 className="text-sm font-semibold text-green-900">
              {submitted.status === "approved" ? "Your review is published" : "Your review is with us"}
            </h3>
            <p className="mt-1 text-sm text-gray-700">
              {submitted.status === "approved"
                ? "Thank you. It is listed above."
                : "Thank you. We check reviews before publishing them, so it will appear here once it has been approved."}
            </p>
            {submitted.status !== "approved" ? (
              <div className="mt-3 border-t border-emerald-100 pt-3">
                <Stars rating={submitted.review.rating} />
                <span className="sr-only">{submitted.review.rating} out of 5</span>
                <ReviewBody review={submitted.review} />
              </div>
            ) : null}
            {formOpen ? null : (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="mt-3 text-sm font-medium text-emerald-700 hover:text-emerald-900"
              >
                Edit your review
              </button>
            )}
          </div>
        ) : null}

        {!mounted ? null : !isAuthenticated ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-4">
            <h3 className="text-sm font-semibold text-green-900">Write a review</h3>
            <p className="mt-1 text-sm text-gray-700">
              Sign in to review this plant. We will bring you back to this page.
            </p>
            <ButtonLink
              href={loginHref}
              prefetch={false}
              tone="secondary"
              size="sm"
              className="mt-3"
            >
              Sign in
            </ButtonLink>
          </div>
        ) : formOpen ? (
          <ReviewForm
            productSlug={productSlug}
            existing={submitted?.review ?? null}
            onSubmitted={handleSubmitted}
            onCancel={() => setFormOpen(false)}
          />
        ) : submitted ? null : (
          <Button
            type="button"
            variant="secondary"
            icon={<PenLine className="h-4 w-4" />}
            onClick={() => setFormOpen(true)}
          >
            Write a review
          </Button>
        )}
      </div>
    </section>
  );
}
