import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Github, Mail, Lock, User, Loader2, CheckCircle2 } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';

function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

interface PasswordStrength {
  score: number;
  color: string;
  label: string;
}

const calculatePasswordStrength = (password: string): PasswordStrength => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return { score, color: 'bg-red-500', label: 'Débil' };
  if (score === 3) return { score, color: 'bg-yellow-500', label: 'Media' };
  return { score, color: 'bg-green-500', label: 'Fuerte' };
};

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const strength = calculatePasswordStrength(password);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) return;
    if (!acceptTerms) return;

    setIsLoading(true);
    console.log('Register submit:', { name, email, password });

    setTimeout(() => {
      setIsLoading(false);
      setIsSuccess(true);
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
            <Link to="/" className="flex items-center gap-2 text-white mb-12">
              <span className="material-symbols-outlined text-2xl">model_training</span>
              <span className="text-lg font-bold">MLOps Platform</span>
            </Link>

            <h1 className="text-5xl font-bold text-white leading-tight">
              Únete a
              <br />
              <span className="bg-gradient-to-r from-white to-[#a1a1aa] bg-clip-text text-transparent">
                MLOps Platform
              </span>
            </h1>
            <p className="mt-6 text-lg text-[#a1a1aa] max-w-md">
              Crea tu cuenta y automatiza tus pipelines de ML
            </p>

            <div className="mt-12 space-y-4">
              {[
                'Pipelines automatizados con cada push',
                'Monitoreo en tiempo real de modelos',
                'Integración directa con GitHub',
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
                <span className="material-symbols-outlined text-2xl">model_training</span>
                <span className="text-lg font-bold">MLOps Platform</span>
              </Link>
            </div>

            <div className="backdrop-blur-xl bg-[#18181b]/60 border border-[#27272a] rounded-2xl p-8">
              <AnimatePresence mode="wait">
                {isSuccess ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-center py-8"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                    >
                      <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
                    </motion.div>
                    <h2 className="text-2xl font-bold text-white mb-2">¡Cuenta creada!</h2>
                    <p className="text-[#a1a1aa] mb-6">
                      Tu cuenta ha sido creada exitosamente.
                    </p>
                    <Link
                      to="/login"
                      className="inline-block rounded-xl bg-[#fafafa] px-6 py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb]"
                    >
                      Iniciar Sesión
                    </Link>
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      <h2 className="text-2xl font-bold text-white">Crea tu cuenta</h2>
                      <p className="mt-2 text-[#a1a1aa]">
                        Empieza a automatizar tus pipelines de ML
                      </p>
                    </motion.div>

                    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                      {/* Name */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                      >
                        <label className="mb-1.5 block text-sm font-medium text-[#a1a1aa]">
                          Nombre completo
                        </label>
                        <div className="relative">
                          <User
                            size={18}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]"
                          />
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Juan Pérez"
                            required
                            className="w-full rounded-xl border border-[#27272a] bg-[#09090b]/50 pl-10 pr-4 py-3 text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]"
                          />
                        </div>
                      </motion.div>

                      {/* Email */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 }}
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
                        transition={{ delay: 0.5 }}
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
                        {/* Strength indicator */}
                        {password && (
                          <div className="mt-2 space-y-1">
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    'h-1 flex-1 rounded-full transition-colors',
                                    i <= strength.score ? strength.color : 'bg-[#27272a]'
                                  )}
                                />
                              ))}
                            </div>
                            <p className="text-xs text-[#a1a1aa]">
                              Fortaleza:{' '}
                              <span
                                className={
                                  strength.score >= 4
                                    ? 'text-green-400'
                                    : strength.score === 3
                                      ? 'text-yellow-400'
                                      : 'text-red-400'
                                }
                              >
                                {strength.label}
                              </span>
                            </p>
                          </div>
                        )}
                      </motion.div>

                      {/* Confirm Password */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.55 }}
                      >
                        <label className="mb-1.5 block text-sm font-medium text-[#a1a1aa]">
                          Confirmar contraseña
                        </label>
                        <div className="relative">
                          <Lock
                            size={18}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]"
                          />
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="w-full rounded-xl border border-[#27272a] bg-[#09090b]/50 pl-10 pr-12 py-3 text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525b] transition-colors hover:text-[#a1a1aa]"
                          >
                            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        {confirmPassword && password !== confirmPassword && (
                          <p className="mt-1 text-xs text-red-400">
                            Las contraseñas no coinciden
                          </p>
                        )}
                      </motion.div>

                      {/* Terms */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                      >
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-[#a1a1aa]">
                          <input
                            type="checkbox"
                            checked={acceptTerms}
                            onChange={(e) => setAcceptTerms(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-[#27272a] bg-[#09090b] accent-[#fafafa]"
                          />
                          <span>
                            Acepto los{' '}
                            <Link
                              to="/terms"
                              className="text-white underline hover:no-underline"
                            >
                              términos y condiciones
                            </Link>
                          </span>
                        </label>
                      </motion.div>

                      {/* Submit */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.65 }}
                      >
                        <button
                          type="submit"
                          disabled={isLoading || !acceptTerms}
                          className="w-full rounded-xl bg-[#fafafa] py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb] disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 size={18} className="animate-spin" />
                              Creando cuenta...
                            </>
                          ) : (
                            'Crear Cuenta'
                          )}
                        </button>
                      </motion.div>

                      {/* Divider */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.7 }}
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
                        transition={{ delay: 0.75 }}
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

                    {/* Login link */}
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                      className="mt-6 text-center text-sm text-[#a1a1aa]"
                    >
                      ¿Ya tienes cuenta?{' '}
                      <Link
                        to="/login"
                        className="font-semibold text-white hover:underline"
                      >
                        Inicia sesión
                      </Link>
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
