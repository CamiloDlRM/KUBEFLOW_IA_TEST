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

export default function Landing() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <>
      {showIntro && <IntroSplash onComplete={() => setShowIntro(false)} />}

      <AnimatePresence>
        {!showIntro && (
          <motion.div
            className="min-h-screen bg-[#09090b] text-white font-['Inter',sans-serif]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <Navbar />
            </motion.div>

            <main className="pt-20">
              <AnimatedSection delay={0.3}>
                <HeroSection />
              </AnimatedSection>

              <AnimatedSection delay={0.15}>
                <PipelineFlow />
              </AnimatedSection>

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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
