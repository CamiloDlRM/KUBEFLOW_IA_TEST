import { Navbar } from "./Navbar";
import { HeroSection } from "./HeroSection";
import { PipelineFlow } from "./PipelineFlow";
import { FeatureCards } from "./FeatureCards";
import { TechStack } from "./TechStack";
import { Footer } from "./Footer";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white font-['Inter',sans-serif]">
      <Navbar />
      <main className="pt-20">
        <HeroSection />
        <PipelineFlow />
        <FeatureCards />
        <TechStack />
      </main>
      <Footer />
    </div>
  );
}
