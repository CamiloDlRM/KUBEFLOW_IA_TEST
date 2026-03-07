import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';

export default function ResetPasswordSuccess() {
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
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                <CheckCircle2 size={36} className="text-green-500" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-center mb-8"
            >
              <h2 className="text-2xl font-bold text-white">
                ¡Contraseña actualizada!
              </h2>
              <p className="mt-3 text-[#a1a1aa]">
                Tu contraseña ha sido restablecida exitosamente. Ya puedes
                iniciar sesión con tu nueva contraseña.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <Link
                to="/login"
                className="flex w-full items-center justify-center rounded-xl bg-[#fafafa] py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb]"
              >
                Ir a iniciar sesión
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
