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
  gift: { icon: "gift", text: "Suitable as a gift" },
  office: { icon: "office", text: "Suits offices and desks" },
  "good-luck": { icon: "gift", text: "Considered a good luck plant" },
  "stress-free": { icon: "easy", text: "Easy care" },
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
    <div className="mt-6">
      <h2 className="mb-2.5 text-sm font-semibold text-green-900">Care at a glance</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tips.map((tip) => (
          <li
            key={tip.text}
            className="flex items-start gap-2 rounded-xl bg-emerald-50/70 px-3 py-2.5"
          >
            <CareTipIcon icon={tip.icon} className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span className="text-[13px] leading-snug text-gray-700">{tip.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
