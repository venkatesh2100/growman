/**
 * Shapes and helpers for the public product reviews endpoint.
 *
 * Reviews are moderated server-side: the list endpoint returns approved
 * reviews only, and a submission from a customer with no matching paid
 * order is held as "pending" until someone approves it.
 */

/** A published review. `author` is the author's first name only. */
export interface ProductReview {
  id: number;
  rating: number;
  title: string;
  comment: string;
  author: string;
  verifiedPurchase: boolean;
  images: string[];
  createdAt: string;
}

export interface RatingBucket {
  rating: number;
  count: number;
}

export interface ProductReviewsResponse {
  reviews: ProductReview[];
  ratingAverage: number;
  ratingCount: number;
  /** Null, not an empty array, when a product has no approved reviews. */
  histogram: RatingBucket[] | null;
}

/** Response to a review submission; `status` is "approved" or "pending". */
export interface CreateReviewResponse {
  success: boolean;
  status: string;
  message: string;
  review: ProductReview;
}

export const REVIEWS_PAGE_SIZE = 5;

export function productReviewsPath(
  slug: string,
  limit: number,
  offset: number
): string {
  return `/products/${encodeURIComponent(slug)}/reviews?limit=${limit}&offset=${offset}`;
}

/** Counts per star level, 5 down to 1, with unrated levels filled in as 0. */
export function ratingDistribution(
  histogram: RatingBucket[] | null | undefined
): RatingBucket[] {
  const counts = new Map<number, number>();
  for (const bucket of histogram ?? []) {
    counts.set(Number(bucket.rating), Number(bucket.count) || 0);
  }
  return [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: counts.get(rating) ?? 0,
  }));
}

/**
 * How many approved reviews exist in total, used to decide whether more
 * pages remain. The histogram and the denormalised count are two views of
 * the same thing; the larger wins so a stale aggregate cannot hide reviews.
 */
export function totalApprovedReviews(
  summary: Pick<ProductReviewsResponse, "ratingCount" | "histogram">
): number {
  const fromHistogram = (summary.histogram ?? []).reduce(
    (sum, bucket) => sum + (Number(bucket.count) || 0),
    0
  );
  return Math.max(fromHistogram, Number(summary.ratingCount) || 0);
}
