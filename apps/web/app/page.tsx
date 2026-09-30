import type { Metadata } from "next";
import HomeHero from "../components/hompage/homeHero";
import PlantSection from "../components/hompage/plantSection";
import CategoryLinksSection from "../components/hompage/CategoryLinksSection";
import BulkAndPickupSection from "../components/hompage/BulkAndPickupSection";
import NurserySection from "../components/hompage/NurserySection";
import DoothaWaitlistPopup from "../components/dootha/DoothaWaitlistPopup";
import JsonLd from "../components/seo/JsonLd";
import { createLocalBusinessJsonLd } from "../lib/seo/jsonLd";
import { siteConfig } from "../lib/seo/site";

export const metadata: Metadata = {
  // Absolute so the homepage keeps its full commercial title rather than
  // having the brand appended twice by the layout's title template.
  title: { absolute: siteConfig.title },
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

/** Catalog-driven sections are revalidated rather than rendered per request. */
// Next.js requires this to be a literal; keep it in step with
// CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

// Server component throughout: the H1, featured products, category links and
// care-guide links are all in the initial HTML, with no JavaScript required.
export default function Home() {
  return (
    <>
      <JsonLd id="home-localbusiness" data={createLocalBusinessJsonLd()} />
      <main>
        <HomeHero />
        <PlantSection />
        <CategoryLinksSection />
        <BulkAndPickupSection />
        <NurserySection />
      </main>
      {/* Client island: renders nothing until a first-time visitor has been on
          the page a few seconds, so it costs the initial render nothing. */}
      <DoothaWaitlistPopup />
    </>
  );
}
