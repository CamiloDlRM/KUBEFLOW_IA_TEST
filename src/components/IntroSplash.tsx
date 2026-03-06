import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShaderAnimation } from './ui/shader-animation';

interface IntroSplashProps {
  onComplete: () => void;
}

export function IntroSplash({ onComplete }: IntroSplashProps) {
  const [visible, setVisible] = useState(true);
  const [shaderReady, setShaderReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {visible && (
        <motion.div
          className="fixed inset-0 z-50 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: shaderReady ? 1 : 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shaderReady ? 0.3 : 0, ease: 'easeInOut' }}
        >
          <ShaderAnimation onReady={() => setShaderReady(true)} />

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <motion.h1
                className="text-4xl md:text-6xl font-bold text-white tracking-tight"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                MLOps Platform
              </motion.h1>

              <motion.p
                className="text-[#a1a1aa] text-lg md:text-xl font-light tracking-wide"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.8, ease: 'easeOut' }}
              >
                Automatización Inteligente de ML
              </motion.p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
