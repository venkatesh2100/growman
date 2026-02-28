"use client";

import HomeHero from "../components/hompage/homeHero";
import Footer from "../components/hompage/footer";
import BenefitsSection from "../components/hompage/benifitsSection";
import NewsLetterSection from "../components/hompage/newsLetter";
import PlantSection from "../components/hompage/plantSection";
// import Testimonials from "./components/testimonals";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F9FBF7]">
      <HomeHero />
      <PlantSection />

      <BenefitsSection />

    {/* <Testimonials /> */}

      <NewsLetterSection />
      <Footer />
    </div>
  );
}
