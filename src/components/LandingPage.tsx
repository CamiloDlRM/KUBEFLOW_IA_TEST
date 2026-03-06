import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IntroSplash } from './IntroSplash';
import { Navbar } from './Navbar';
import { HeroSection } from './HeroSection';
import { PipelineFlow } from './PipelineFlow';
import { FeatureCards } from './FeatureCards';
import { TechStack } from './TechStack';
import { Footer } from './Footer';

function AnimatedSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function LandingPage() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <>
      <AnimatePresence>
        {showIntro && <IntroSplash onComplete={() => setShowIntro(false)} />}
      </AnimatePresence>

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

              <AnimatedSection delay={0.45}>
                <PipelineFlow />
              </AnimatedSection>

              <AnimatedSection delay={0.6}>
                <FeatureCards />
              </AnimatedSection>

              <AnimatedSection delay={0.75}>
                <TechStack />
              </AnimatedSection>
            </main>

            <AnimatedSection delay={0.9}>
              <Footer />
            </AnimatedSection>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
