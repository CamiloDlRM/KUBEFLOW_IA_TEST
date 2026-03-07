import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Github, Mail, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    console.log('Login submit:', { email, password, remember });

    setTimeout(() => {
      setIsLoading(false);
    }, 2000);
  }

  return (
    <div className="relative min-h-screen bg-[#09090b] font-['Inter',sans-serif] overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex min-h-screen">
        {/* Left Column - Branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 xl:px-24">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Link to="/" className="flex items-center gap-2 text-white mb-6">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="28" height="28" rx="8" stroke="currentColor" strokeWidth="2"/>
                <circle cx="16" cy="10" r="3" fill="currentColor"/>
                <circle cx="9" cy="22" r="3" fill="currentColor"/>
                <circle cx="23" cy="22" r="3" fill="currentColor"/>
                <line x1="16" y1="13" x2="9" y2="19" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="16" y1="13" x2="23" y2="19" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span className="text-lg font-bold">MLOps Platform</span>
            </Link>

            <h1 className="text-5xl font-bold text-white leading-tight">
              Bienvenido
              <br />
              <span className="bg-gradient-to-r from-white to-[#a1a1aa] bg-clip-text text-transparent">
                de vuelta
              </span>
            </h1>
            <p className="mt-6 text-lg text-[#a1a1aa] max-w-md">
              Inicia sesión para continuar automatizando tus pipelines
            </p>

            <div className="mt-12 space-y-4">
              {[
                'Monitorea tus modelos en producción',
                'Revisa el estado de tus pipelines',
                'Gestiona repositorios y despliegues',
              ].map((feature, i) => (
                <motion.div
                  key={feature}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.15, duration: 0.5 }}
                  className="flex items-center gap-3 text-[#a1a1aa]"
                >
                  <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                  <span>{feature}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right Column - Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="w-full max-w-md"
          >
            {/* Mobile logo */}
            <div className="lg:hidden mb-8">
              <Link to="/" className="flex items-center gap-2 text-white">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="2" width="28" height="28" rx="8" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="16" cy="10" r="3" fill="currentColor"/>
                  <circle cx="9" cy="22" r="3" fill="currentColor"/>
                  <circle cx="23" cy="22" r="3" fill="currentColor"/>
                  <line x1="16" y1="13" x2="9" y2="19" stroke="currentColor" strokeWidth="1.5"/>
                  <line x1="16" y1="13" x2="23" y2="19" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <span className="text-lg font-bold">MLOps Platform</span>
              </Link>
            </div>

            <div className="backdrop-blur-xl bg-[#18181b]/60 border border-[#27272a] rounded-2xl p-8">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h2 className="text-2xl font-bold text-white">Iniciar Sesión</h2>
                <p className="mt-2 text-[#a1a1aa]">
                  Ingresa tus credenciales para continuar
                </p>
              </motion.div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {/* Email */}
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

                {/* Password */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                >
                  <label className="mb-1.5 block text-sm font-medium text-[#a1a1aa]">
                    Contraseña
                  </label>
                  <div className="relative">
                    <Lock
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]"
                    />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full rounded-xl border border-[#27272a] bg-[#09090b]/50 pl-10 pr-12 py-3 text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525b] transition-colors hover:text-[#a1a1aa]"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </motion.div>

                {/* Remember + Forgot */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="flex items-center justify-between"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[#a1a1aa]">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 rounded border-[#27272a] bg-[#09090b] accent-[#fafafa]"
                    />
                    Recordarme
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-[#a1a1aa] transition-colors hover:text-white"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </motion.div>

                {/* Submit */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 }}
                >
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-xl bg-[#fafafa] py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Iniciando sesión...
                      </>
                    ) : (
                      'Iniciar Sesión'
                    )}
                  </button>
                </motion.div>

                {/* Divider */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="flex items-center gap-4"
                >
                  <div className="h-px flex-1 bg-[#27272a]" />
                  <span className="text-sm text-[#52525b]">O continuar con</span>
                  <div className="h-px flex-1 bg-[#27272a]" />
                </motion.div>

                {/* GitHub */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#27272a] bg-transparent py-3 text-white transition-colors hover:bg-[#27272a]/50"
                  >
                    <Github size={20} />
                    Continuar con GitHub
                  </button>
                </motion.div>
              </form>

              {/* Register link */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="mt-6 text-center text-sm text-[#a1a1aa]"
              >
                ¿No tienes cuenta?{' '}
                <Link
                  to="/register"
                  className="font-semibold text-white hover:underline"
                >
                  Regístrate
                </Link>
              </motion.p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
