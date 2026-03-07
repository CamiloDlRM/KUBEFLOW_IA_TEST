import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IntroSplash } from '@/components/IntroSplash';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { PipelineFlow } from '@/components/landing/PipelineFlow';
import { FeatureCards } from '@/components/landing/FeatureCards';
import { TechStack } from '@/components/landing/TechStack';
import { Footer } from '@/components/landing/Footer';
import { AnimatedSection } from '@/components/landing/AnimatedSection';

function shouldShowIntro(): boolean {
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const isRefresh = navEntry?.type === 'reload';
  const introShown = sessionStorage.getItem('introShown');

  // Show intro on first visit or page refresh
  return !introShown || isRefresh;
}

export default function Landing() {
  const [introNeeded] = useState(shouldShowIntro);
  const [showIntro, setShowIntro] = useState(introNeeded);

  function handleIntroComplete() {
    sessionStorage.setItem('introShown', 'true');
    setShowIntro(false);
  }

  const landingContent = (
    <div className="min-h-screen bg-[#09090b] text-white font-['Inter',sans-serif]">
      <Navbar />

      <main className="pt-20">
        <HeroSection />

        <PipelineFlow />

        <AnimatedSection>
          <FeatureCards />
        </AnimatedSection>

        <AnimatedSection>
          <TechStack />
        </AnimatedSection>
      </main>

      <AnimatedSection>
        <Footer />
      </AnimatedSection>
    </div>
  );

  // No intro needed — render landing directly without any animation
  if (!introNeeded) {
    return landingContent;
  }

  // Intro flow: show intro first, then fade in landing
  return (
    <AnimatePresence mode="wait">
      {showIntro ? (
        <IntroSplash key="intro" onComplete={handleIntroComplete} />
      ) : (
        <motion.div
          key="landing"
          style={{ willChange: 'opacity' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {landingContent}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
