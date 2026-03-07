import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, ArrowLeft, ArrowRight } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';

export default function ForgotPasswordSent() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as { email?: string })?.email ?? '';
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (!email) {
      navigate('/forgot-password', { replace: true });
    }
  }, [email, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = useCallback(() => {
    setCooldown(60);
  }, []);

  if (!email) return null;

  return (
    <div className="relative min-h-screen bg-[#09090b] font-['Inter',sans-serif] overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          <div className="backdrop-blur-xl bg-[#18181b]/60 border border-[#27272a] rounded-2xl p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="flex justify-center mb-6"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#27272a]/50">
                <Mail size={32} className="text-[#a1a1aa]" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-center mb-6"
            >
              <h2 className="text-2xl font-bold text-white">
                Revisa tu correo
              </h2>
              <p className="mt-3 text-[#a1a1aa]">
                Hemos enviado un enlace de recuperación a{' '}
                <span className="font-bold text-white">{email}</span>
              </p>
              <p className="mt-2 text-sm text-[#52525b]">
                Si no ves el correo, revisa tu carpeta de spam
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="space-y-3"
            >
              <button
                onClick={handleResend}
                disabled={cooldown > 0}
                className="w-full rounded-xl border border-[#27272a] bg-transparent py-3 font-semibold text-[#fafafa] transition-colors hover:bg-[#27272a]/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cooldown > 0
                  ? `Reenviar en ${cooldown}s`
                  : 'Reenviar correo'}
              </button>

              <Link
                to="/reset-password"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#27272a] bg-[#27272a]/30 py-3 text-sm text-[#a1a1aa] transition-colors hover:bg-[#27272a]/50 hover:text-white"
              >
                Simular click en email
                <ArrowRight size={14} />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 text-center"
            >
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[#a1a1aa] transition-colors hover:text-white"
              >
                <ArrowLeft size={14} />
                Volver a iniciar sesión
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
