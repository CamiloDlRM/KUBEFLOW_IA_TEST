import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Mail, Loader2, ArrowLeft } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      navigate('/forgot-password/sent', { state: { email } });
    }, 2000);
  }

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
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="flex justify-center mb-6"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#27272a]/50">
                <Lock size={24} className="text-[#a1a1aa]" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-center mb-6"
            >
              <h2 className="text-2xl font-bold text-white">
                ¿Olvidaste tu contraseña?
              </h2>
              <p className="mt-2 text-sm text-[#a1a1aa]">
                Ingresa tu correo y te enviaremos un enlace para restablecer tu
                contraseña
              </p>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <label className="mb-1.5 block text-sm font-medium text-[#a1a1aa]">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    className="w-full rounded-xl border border-[#27272a] bg-[#09090b]/50 pl-10 pr-4 py-3 text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]"
                  />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-xl bg-[#fafafa] py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar enlace de recuperación'
                  )}
                </button>
              </motion.div>
            </form>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
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
