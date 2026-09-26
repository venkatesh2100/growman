/**
 * File-based content model for the plant-care blog.
 *
 * Articles live here as typed data rather than in a CMS so they ship with the
 * build, stay type-checked and render as static HTML. Adding an article means
 * appending one entry to `posts` — its page, metadata, sitemap entry and
 * Article structured data are all derived automatically.
 *
 * Content rules: every article must be genuinely useful care guidance,
 * written for the customer. `relatedCategories` must reference category slugs
 * that exist in the catalog, and `relatedTags` must be tags the catalog
 * actually uses, so internal links never 404.
 */

export type BlogSection = {
  heading: string;
  paragraphs: string[];
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[];
};

export type BlogPost = {
  slug: string;
  title: string;
  /** Meta description; also used as the article standfirst. */
  description: string;
  /** ISO date the article was first published. */
  publishedAt: string;
  /** ISO date of the last substantive edit, when it differs from publication. */
  updatedAt?: string;
  /** Minutes, used only for the visible reading-time hint. */
  readingMinutes: number;
  sections: BlogSection[];
  /** Category slugs to link to from the article body. */
  relatedCategories: string[];
};

export const posts: BlogPost[] = [
  {
    slug: "best-indoor-plants-for-indian-homes",
    title: "Best Indoor Plants for Indian Homes",
    description:
      "How to choose indoor plants that cope with Indian light, heat and humidity, and where to place them in a flat or house.",
    publishedAt: "2026-01-12",
    readingMinutes: 6,
    relatedCategories: ["indoor-plants", "ornamental-plants"],
    sections: [
      {
        heading: "Start with the light you actually have",
        paragraphs: [
          "The most common reason an indoor plant fails is not neglect — it is being placed somewhere it was never going to survive. Before buying anything, spend a day noticing how light moves through the room you have in mind. A spot two metres back from a south- or west-facing window in most Indian cities receives bright indirect light for several hours, which suits the widest range of foliage plants. A north-facing room, an internal corridor, or a bathroom with a small high window is a genuinely low-light position, and only a narrow set of plants will hold their leaves there.",
          "Light also changes with the season. A balcony door that gives gentle morning sun in December can deliver harsh direct heat by April. If a plant scorches or pales every summer, the fix is usually to move it a metre further from the glass rather than to water it more.",
        ],
      },
      {
        heading: "Match the plant to the room",
        paragraphs: [
          "Once you know the light, the choice gets much simpler. Group your rooms into three rough categories and buy accordingly.",
        ],
        bullets: [
          "Bright indirect light, away from direct sun: most foliage plants do well here, and this is where a feature plant earns its place.",
          "Low light, such as north-facing rooms and corridors: choose from plants specifically sold as low-light tolerant, and expect slower growth rather than none.",
          "Air-conditioned rooms: air conditioning dries the air considerably. Plants here need less frequent but more thorough watering, and benefit from being kept out of the direct airflow.",
        ],
      },
      {
        heading: "Give new plants two weeks to settle",
        paragraphs: [
          "A plant that has just moved from a nursery to your living room is adjusting to different light, humidity and airflow all at once. It is normal to lose a leaf or two in the first fortnight. During that period, keep it in its intended position, water only when the top few centimetres of soil are dry, and resist the urge to repot or fertilise. Repotting a plant that is already stressed is the fastest way to lose it.",
          "After a month, if the plant is pushing out new growth, it has accepted the position. If it is still dropping leaves, change the light before you change anything else.",
        ],
      },
      {
        heading: "Plan for the summer and the monsoon",
        paragraphs: [
          "Indian indoor growing has two demanding seasons. Through the hot, dry pre-monsoon months, pots dry out far faster than the rest of the year and most plants need checking every two or three days. Once the monsoon arrives, humidity climbs and the same pot may stay damp for a week — continuing a summer watering routine into the monsoon is one of the most reliable ways to cause root rot.",
          "The practical answer is to water by checking the soil rather than by the calendar. Push a finger two to three centimetres into the pot; if it comes out with soil clinging to it, wait.",
        ],
      },
    ],
  },
  {
    slug: "how-often-to-water-indoor-plants",
    title: "How Often to Water Indoor Plants",
    description:
      "A practical watering method for Indian conditions: how to check the soil, how the seasons change the routine, and how to spot over- and under-watering.",
    publishedAt: "2026-01-20",
    readingMinutes: 5,
    relatedCategories: ["indoor-plants", "medicinal"],
    sections: [
      {
        heading: "Stop watering on a schedule",
        paragraphs: [
          "Fixed routines — every Sunday, twice a week — fail because they ignore everything that actually determines how fast a pot dries: pot size and material, soil mix, room temperature, humidity and how much light the plant is getting. The same plant may need water twice a week in May and once a fortnight in August.",
          "Replace the schedule with a check. Push a finger two to three centimetres into the soil, or lift the pot and note its weight. Dry soil at that depth, or a pot that feels noticeably light, means it is time to water. Damp soil means wait and check again in two days.",
        ],
      },
      {
        heading: "Water thoroughly, then let it drain",
        paragraphs: [
          "When you do water, water properly. Add water slowly across the whole surface until it runs from the drainage hole, which wets the entire root ball rather than just the top layer. Small daily splashes encourage roots to stay near the surface, where they dry out fastest.",
          "Then get rid of the runoff. A pot left standing in a saucer of water keeps the lower roots waterlogged and starved of air, and that — not dryness — is what kills most indoor plants. Tip the saucer out ten minutes after watering.",
        ],
      },
      {
        heading: "Read the symptoms correctly",
        paragraphs: [
          "Over- and under-watering can look similar at a glance, and treating one as the other makes things worse. A few distinctions help.",
        ],
        bullets: [
          "Under-watered: leaves go limp but stay dry and papery, edges turn crisp and brown, and the soil has pulled away from the sides of the pot.",
          "Over-watered: lower leaves yellow and drop while still soft, the soil stays wet for days, and the base of the stem may feel soft or smell sour.",
          "Both can cause drooping. Check the soil before deciding — drooping in wet soil means the roots are struggling, and more water will finish them off.",
        ],
      },
      {
        heading: "Adjust for the pot and the season",
        paragraphs: [
          "Terracotta breathes and dries out faster than plastic or ceramic, so the same plant in terracotta needs checking more often. Large pots hold moisture far longer than small ones, which is why a newly potted-up plant often needs less frequent watering than it did before.",
          "Through the monsoon, reduce watering markedly and improve airflow around your plants. Through the hot months, check more often and water early in the morning or after sunset so less is lost to evaporation.",
        ],
      },
    ],
  },
  {
    slug: "outdoor-and-balcony-plant-care-in-india",
    title: "Outdoor and Balcony Plant Care in India",
    description:
      "Caring for outdoor and balcony plants through Indian summers and monsoons: sun exposure, watering, wind, drainage and seasonal repotting.",
    publishedAt: "2026-02-03",
    readingMinutes: 6,
    relatedCategories: ["outdoor-plants", "fruit-plants", "avenue"],
    sections: [
      {
        heading: "Work out your real sun exposure",
        paragraphs: [
          "Balconies vary enormously. A west-facing balcony above the third floor can take six hours of hard afternoon sun and reflected heat from the building, which is a genuinely harsh position. An east-facing balcony gets gentler morning light and is far more forgiving. Watch where the shadow line falls at eleven in the morning and again at four in the afternoon, and you will know what you can grow.",
          "Full-sun outdoor plants need that exposure to grow well and will become sparse and leggy in shade. The reverse is also true: moving a plant grown under nursery shade netting straight into full afternoon sun will scorch its leaves. Introduce it over a week or two, increasing exposure gradually.",
        ],
      },
      {
        heading: "Drainage matters more outdoors",
        paragraphs: [
          "Outdoor pots catch the full monsoon. A pot without a clear drainage path will hold water for days during heavy rain, and few plants tolerate that. Check that every drainage hole is open and not sitting flush against the floor — raising pots on feet or a couple of tiles makes a real difference.",
          "During extended heavy rain, move smaller pots under cover if you can. It is far easier to water a sheltered plant than to recover one whose roots have been sitting in water for a week.",
        ],
      },
      {
        heading: "Account for wind and heat",
        paragraphs: [
          "Wind is the factor most people overlook on higher floors. It dries soil and leaves faster than sun alone and can snap the stems of tall plants. Group pots together so they shelter each other, place heavier pots on the exposed side, and stake anything tall before the pre-monsoon winds arrive rather than after.",
          "Through peak summer, a layer of mulch on the soil surface noticeably slows evaporation and keeps root temperatures down. Watering early in the morning gives the plant the whole day to use the water.",
        ],
      },
      {
        heading: "Repot and prune at the right time",
        paragraphs: [
          "The best time to repot or hard-prune most outdoor plants is at the start of a growing season, when the plant has the vigour to recover — typically as the weather turns after summer, or early in the monsoon. Repotting in the middle of a heatwave asks a plant to rebuild its roots at exactly the moment it is under the most stress.",
          "Signs a plant is ready to move up a pot size include roots emerging from the drainage holes, water running straight through without wetting the soil, and growth slowing despite good conditions. Increase the pot diameter by a few centimetres rather than moving to something much larger.",
        ],
      },
    ],
  },
];

/** Posts ordered newest first, for the blog index. */
export function getAllPosts(): BlogPost[] {
  return [...posts].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

/** A single post by slug, or undefined when it does not exist. */
export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((post) => post.slug === slug);
}
