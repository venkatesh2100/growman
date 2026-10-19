"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { apiFetch, readApiError, readJson } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { FormField, FormTextarea } from "../../../components/ui/Input";
import { toast } from "../../../lib/toast";
import type { CreateReviewResponse, ProductReview } from "../../../lib/reviews";

const TITLE_MAX = 140;
const COMMENT_MAX = 4000;
const STAR_VALUES = [1, 2, 3, 4, 5];

function starLabel(value: number): string {
  return value === 1 ? "1 star" : `${value} stars`;
}

export default function ReviewForm({
  productSlug,
  existing,
  onSubmitted,
  onCancel,
}: {
  productSlug: string;
  existing?: ProductReview | null;
  onSubmitted: (result: CreateReviewResponse) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hovered, setHovered] = useState(0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (rating < 1) {
      setError("Choose a rating from one to five stars.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const res = await apiFetch(`/products/${encodeURIComponent(productSlug)}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          rating,
          title: title.trim(),
          comment: comment.trim(),
        }),
      });

      if (!res.ok) {
        const message =
          res.status === 401
            ? "Your session has ended. Sign in again to post your review."
            : await readApiError(res, "Could not save your review. Please try again.");
        setError(message);
        toast(message, "error");
        return;
      }

      onSubmitted(await readJson<CreateReviewResponse>(res));
    } catch {
      const message = "No connection. Check your internet and try again.";
      setError(message);
      toast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <fieldset onMouseLeave={() => setHovered(0)}>
        <legend className="mb-1.5 text-sm font-medium text-gray-700">Your rating</legend>
        <div className="flex items-center gap-1">
          {STAR_VALUES.map((value) => (
            <label
              key={value}
              className="cursor-pointer p-0.5"
              onMouseEnter={() => setHovered(value)}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <Star
                aria-hidden="true"
                className={`h-7 w-7 rounded transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 ${
                  value <= (hovered || rating)
                    ? "fill-amber-400 text-amber-400"
                    : "text-gray-300"
                }`}
              />
              <span className="sr-only">{starLabel(value)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <FormField
        label="Title (optional)"
        value={title}
        maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Sum up your experience"
      />

      <FormTextarea
        label="Your review (optional)"
        value={comment}
        rows={4}
        maxLength={COMMENT_MAX}
        onChange={(e) => setComment(e.target.value)}
        placeholder="How did the plant arrive, and how is it doing?"
        hint="If you have reviewed this plant before, this replaces your earlier review."
      />

      {error ? (
        <p role="alert" className="text-sm text-green-950/55">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          variant="solid"
          className="sm:w-auto sm:px-6"
          loading={submitting}
          loadingText="Posting..."
        >
          {existing ? "Update review" : "Post review"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
