import {
  Sun,
  Droplets,
  BarChart3,
  Leaf,
  TreePine,
  Wind,
  Gift,
  Building2,
  Scissors,
  CloudSun,
} from "lucide-react";

export type CareTipIcon =
  | "sun"
  | "water"
  | "easy"
  | "outdoor"
  | "air"
  | "shade"
  | "gift"
  | "office"
  | "bonsai"
  | "leaf";

export type CareTip = { icon: CareTipIcon; text: string };

const DEFAULT_CARE_TIPS: CareTip[] = [
  { icon: "sun", text: "Bright indirect light" },
  { icon: "water", text: "Keep soil moist" },
  { icon: "easy", text: "Easy to care" },
];

const CATEGORY_CARE_TIPS: Record<string, CareTip[]> = {
  "indoor-plants": [
    { icon: "sun", text: "Bright indirect light" },
    { icon: "water", text: "Keep soil moist" },
    { icon: "easy", text: "Easy to care" },
  ],
  "outdoor-plants": [
    { icon: "sun", text: "Full sun preferred" },
    { icon: "water", text: "Water regularly" },
    { icon: "outdoor", text: "Outdoor hardy" },
  ],
  avenue: [
    { icon: "sun", text: "Full sunlight" },
    { icon: "outdoor", text: "Avenue planting" },
    { icon: "easy", text: "Low maintenance" },
  ],
  "ornamental-plants": [
    { icon: "sun", text: "Moderate light" },
    { icon: "water", text: "Even moisture" },
    { icon: "easy", text: "Decorative foliage" },
  ],
};

const TAG_CARE_TIPS: Record<string, CareTip> = {
  "low-light": { icon: "shade", text: "Low light tolerant" },
  "air-purify": { icon: "air", text: "Air purifying" },
  "air purify": { icon: "air", text: "Air purifying" },
  bonsai: { icon: "bonsai", text: "Needs pruning" },
  gift: { icon: "gift", text: "Perfect gift plant" },
  office: { icon: "office", text: "Office friendly" },
  "good-luck": { icon: "gift", text: "Good luck plant" },
  "stress-free": { icon: "easy", text: "Stress-free care" },
  indoor: { icon: "sun", text: "Indoor suitable" },
  outdoor: { icon: "outdoor", text: "Best outdoors" },
  medicinal: { icon: "leaf", text: "Medicinal plant" },
};

function normalizeCategoryKey(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

export function getCareTips(
  category?: { name?: string; slug?: string },
  tags?: string[]
): CareTip[] {
  const slugKey = normalizeCategoryKey(category?.slug);
  const nameKey = normalizeCategoryKey(category?.name);
  const base =
    CATEGORY_CARE_TIPS[slugKey] ??
    CATEGORY_CARE_TIPS[nameKey] ??
    DEFAULT_CARE_TIPS;

  const tips = [...base];
  const seen = new Set(tips.map((tip) => tip.text));

  for (const tag of tags ?? []) {
    const tagTip =
      TAG_CARE_TIPS[normalizeCategoryKey(tag)] ??
      TAG_CARE_TIPS[tag.trim().toLowerCase()];
    if (tagTip && !seen.has(tagTip.text)) {
      tips.push(tagTip);
      seen.add(tagTip.text);
    }
  }

  return tips.slice(0, 6);
}

function CareTipIcon({ icon, className }: { icon: CareTipIcon; className?: string }) {
  switch (icon) {
    case "sun":
      return <Sun className={className} strokeWidth={2} />;
    case "water":
      return <Droplets className={className} strokeWidth={2} />;
    case "easy":
      return <BarChart3 className={className} strokeWidth={2} />;
    case "outdoor":
      return <TreePine className={className} strokeWidth={2} />;
    case "air":
      return <Wind className={className} strokeWidth={2} />;
    case "shade":
      return <CloudSun className={className} strokeWidth={2} />;
    case "gift":
      return <Gift className={className} strokeWidth={2} />;
    case "office":
      return <Building2 className={className} strokeWidth={2} />;
    case "bonsai":
      return <Scissors className={className} strokeWidth={2} />;
    case "leaf":
      return <Leaf className={className} strokeWidth={2} />;
    default:
      return <Leaf className={className} strokeWidth={2} />;
  }
}

export function ProductCareTips({
  category,
  tags,
}: {
  category?: { name?: string; slug?: string };
  tags?: string[];
}) {
  const tips = getCareTips(category, tags);
  if (tips.length === 0) return null;

  return (
    <div className="mb-4 sm:mb-6">
      <h3 className="mb-2 sm:mb-3 text-base font-semibold text-gray-900 sm:text-lg">
        Plant Care Tips
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {tips.map((tip) => (
          <div
            key={tip.text}
            className="flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3"
          >
            <CareTipIcon
              icon={tip.icon}
              className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
            />
            <span className="text-sm leading-snug text-slate-700">{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
