import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import AnimatedBackground from '../components/AnimatedBackground';
import { calculatePasswordStrength } from '../utils/passwordStrength';

function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const strength = calculatePasswordStrength(password);
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    passwordsMatch &&
    strength.score > 2;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      navigate('/reset-password/success');
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
                <KeyRound size={24} className="text-[#a1a1aa]" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-center mb-6"
            >
              <h2 className="text-2xl font-bold text-white">
                Crea tu nueva contraseña
              </h2>
              <p className="mt-2 text-sm text-[#a1a1aa]">
                Tu nueva contraseña debe ser diferente a la anterior
              </p>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* New Password */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <label className="mb-1.5 block text-sm font-medium text-[#a1a1aa]">
                  Nueva contraseña
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
                transition={{ delay: 0.5 }}
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
                    className={cn(
                      'w-full rounded-xl border bg-[#09090b]/50 pl-10 pr-12 py-3 text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]',
                      confirmPassword && !passwordsMatch
                        ? 'border-red-500'
                        : 'border-[#27272a]'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525b] transition-colors hover:text-[#a1a1aa]"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="mt-1 text-xs text-red-400">
                    Las contraseñas no coinciden
                  </p>
                )}
              </motion.div>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <button
                  type="submit"
                  disabled={!canSubmit || isLoading}
                  className="w-full rounded-xl bg-[#fafafa] py-3 font-semibold text-[#09090b] transition-colors hover:bg-[#e5e7eb] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Restableciendo...
                    </>
                  ) : (
                    'Restablecer contraseña'
                  )}
                </button>
              </motion.div>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
