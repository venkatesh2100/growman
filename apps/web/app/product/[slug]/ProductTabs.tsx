"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import type { Review } from "../../../lib/types";

type TabKey = "description" | "specifications" | "reviews";

function parseSpecifications(specifications: unknown): Array<[string, string]> {
  if (!specifications) return [];
  if (typeof specifications === "string") {
    return specifications
      .split("|")
      .map((item) => {
        const [label, ...rest] = item.split(":");
        return [label?.trim() ?? "", rest.join(":").trim()] as [string, string];
      })
      .filter(([label, value]) => label && value);
  }
  if (typeof specifications === "object") {
    return Object.entries(specifications as Record<string, unknown>).map(
      ([key, value]) => [key, String(value)] as [string, string]
    );
  }
  return [];
}

function Stars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span className="flex" aria-hidden="true">
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className={`${size} ${i < Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
        />
      ))}
    </span>
  );
}

export default function ProductTabs({
  fullDescription,
  specifications,
  reviews,
}: {
  fullDescription: string;
  specifications?: unknown;
  reviews: Review[];
}) {
  const specs = parseSpecifications(specifications);
  const paragraphs = fullDescription.split("\n").map((p) => p.trim()).filter(Boolean);

  const tabs: Array<{ key: TabKey; label: string }> = [
    ...(paragraphs.length > 0 ? [{ key: "description" as const, label: "Description" }] : []),
    ...(specs.length > 0 ? [{ key: "specifications" as const, label: "Specifications" }] : []),
    { key: "reviews", label: `Reviews (${reviews.length})` },
  ];
  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]?.key ?? "reviews");

  const average =
    reviews.length > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0;

  return (
    <section className="mt-12 rounded-2xl border border-emerald-100 bg-white" aria-label="Product information">
      <div role="tablist" className="flex gap-6 overflow-x-auto border-b border-emerald-100 px-5 sm:px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`panel-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`-mb-px shrink-0 border-b-2 py-3.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-emerald-700 text-green-900"
                : "border-transparent text-gray-500 hover:text-green-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="px-5 py-6 sm:px-6"
      >
        {activeTab === "description" && (
          <div className="max-w-3xl space-y-4 text-[15px] leading-relaxed text-gray-700">
            {paragraphs.map((para, idx) => (
              <p key={idx}>{para}</p>
            ))}
          </div>
        )}

        {activeTab === "specifications" && (
          <dl className="grid max-w-3xl grid-cols-1 gap-x-8 sm:grid-cols-2">
            {specs.map(([label, value], idx) => (
              <div key={idx} className="flex gap-3 border-b border-emerald-50 py-2.5 text-sm">
                <dt className="w-2/5 shrink-0 text-gray-500">{label}</dt>
                <dd className="text-green-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {activeTab === "reviews" &&
          (reviews.length > 0 ? (
            <div className="max-w-3xl">
              <div className="mb-6 flex items-center gap-4">
                <span className="font-space text-4xl font-semibold text-green-900">
                  {average.toFixed(1)}
                </span>
                <div>
                  <Stars rating={average} size="h-5 w-5" />
                  <p className="mt-1 text-sm text-gray-500">
                    Based on {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
                  </p>
                </div>
              </div>
              <ul className="divide-y divide-emerald-50">
                {reviews.map((review) => (
                  <li key={review.id} className="py-4">
                    <Stars rating={review.rating} />
                    {review.comment ? (
                      <p className="mt-2 text-sm leading-relaxed text-gray-700">{review.comment}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-gray-500">
                      {review.user?.name || "Growman customer"}
                      {review.createdAt
                        ? ` · ${new Date(review.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-600">This plant has no reviews yet.</p>
          ))}
      </div>
    </section>
  );
}
