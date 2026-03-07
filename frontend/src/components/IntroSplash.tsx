import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShaderAnimation } from './ui/ShaderAnimation';

interface IntroSplashProps {
  onComplete: () => void;
}

export function IntroSplash({ onComplete }: IntroSplashProps) {
  const [shaderReady, setShaderReady] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-hidden bg-[#09090b]"
      initial={{ opacity: 0 }}
      animate={{ opacity: exiting ? 0 : shaderReady ? 1 : 0 }}
      transition={{ duration: exiting ? 0.4 : shaderReady ? 0.3 : 0, ease: 'easeInOut' }}
      onAnimationComplete={() => {
        if (exiting) onComplete();
      }}
    >
      {/* Shader background */}
      <ShaderAnimation onReady={() => setShaderReady(true)} />

      {/* Centered text overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          {/* Logo icon */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <svg
              className="w-12 h-12 text-white/80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </motion.div>

          {/* Title */}
          <motion.h1
            className="text-4xl md:text-6xl font-bold text-white tracking-tight"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            MLOps Platform
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className="text-[#a1a1aa] text-lg md:text-xl font-light tracking-wide"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8, ease: 'easeOut' }}
          >
            Automatización Inteligente de ML
          </motion.p>

          {/* Loading bar */}
          <motion.div
            className="mt-6 h-[1px] bg-white/20 rounded-full overflow-hidden"
            initial={{ width: 0 }}
            animate={{ width: 120 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <motion.div
              className="h-full bg-white/60"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 2, delay: 1.4, ease: 'easeInOut' }}
            />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
