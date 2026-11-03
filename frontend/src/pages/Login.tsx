import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import MicroSlats from '@/components/MicroSlats';
import { useMediaQuery } from 'react-responsive';
import { ArrowLeft } from 'lucide-react';
import { GITHUB_LOGIN_URL } from '../api/client';
import { GithubIcon } from '@/components/AuthProviderIcon';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const isMobile = useMediaQuery({ maxWidth: 768 });

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    setLoading(true);
    try {
      if (isRegistering) {
        await register({ username, email, password, github_token: githubToken.trim() });
      } else {
        await login({ username, password });
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none fixed inset-0">
        <MicroSlats
          preset="swell"
          color="#0f172a"
          glintColor="#818cf8"
          backgroundColor="#020617"
          slatWidth={10}
          slatHeight={25}
          gap={3}
          roundness={0.75}
          interactive={!isMobile}
          cursorStrength={1}
          cursorSize={40}
          swirl={0}
          trail={1.4}
          lean={0}
          intro = {false}
          scale={1.5}
          speed={0.6}
          direction={250}
          chop={0.55}
          stretch={0}
          glint={0.7}
          contrast={1.25}
          perspective={0.55}
          fog={0.55}
          introDuration={1.5}
          paused={false}
        />
      </div>

      <Link
        to="/"
        className="font-body absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 backdrop-blur-sm transition hover:border-indigo-500 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Home
      </Link>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center text-center">
          <h1 className="font-body text-4xl font-bold text-slate-100"> Sign in to {' '}
            <span className="font-display bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              Maia
            </span>
            !</h1>
          <p className="font-body2 text-xl text-slate-400">From code to deployment</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur-sm">
          <motion.form
            key={isRegistering ? 'register' : 'login'}
            onSubmit={handleSubmit}
            className="space-y-4"
            initial={{ opacity: 0, x: isRegistering ? 16 : -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => setUsernameFocused(false)}
                  aria-describedby="username-hint"
                  placeholder=" "
                  className="peer w-full rounded-lg border border-slate-700 bg-slate-800 px-3 pb-2 pt-5 font-body2 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <label
                  htmlFor="username"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-slate-800 px-1 font-body2 text-sm text-slate-400 transition-all peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-brand-500 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
                >
                  Username
                </label>
              </div>
              <AnimatePresence initial={false}>
                {usernameFocused && (
                  <motion.p
                    id="username-hint"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="mt-2 overflow-hidden rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 font-body2 text-xs text-indigo-200"
                  >
                    {isRegistering ? (
                      <>Your username will be saved as <strong>{username.replace(/@[gt]$/, '') || 'name'}@t</strong>. You can sign in with or without the <strong>@t</strong>.</>
                    ) : (
                      <>
                        Signed up with a password? Just type your username (e.g. <strong>wil</strong>); the <strong>@t</strong> is optional.
                        Using GitHub? Just press <strong>Continue with GitHub</strong> below: no username needed.
                      </>
                    )}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false} mode="popLayout">
              {isRegistering && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder=" "
                    className="peer w-full rounded-lg border border-slate-700 bg-slate-800 px-3 pb-2 pt-5 font-body2 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <label
                    htmlFor="email"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-slate-800 px-1 font-body2 text-sm text-slate-400 transition-all peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-brand-500 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
                  >
                    Email
                  </label>
                </div>
                <div className="relative mt-4">
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    required
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder=" "
                    className="peer w-full rounded-lg border border-slate-700 bg-slate-800 px-3 pb-2 pt-5 font-body2 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <label
                    htmlFor="github-token"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-slate-800 px-1 font-body2 text-sm text-slate-400 transition-all peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-brand-500 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
                  >
                    GitHub token (ghp_…)
                  </label>
                </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <div className="relative">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=" "
                  className="peer w-full rounded-lg border border-slate-700 bg-slate-800 px-3 pb-2 pt-5 font-body2 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <label
                  htmlFor="password"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-slate-800 px-1 font-body2 text-sm text-slate-400 transition-all peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-brand-500 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
                >
                  Password
                </label>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-indigo-600/30 transition-all duration-300 ease-in hover:scale-[1.02] hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (isRegistering ? 'Creating account…' : 'Signing in…') : isRegistering ? 'Create account' : 'Sign in'}
            </button>
          </motion.form>

          <div className="my-4 flex items-center gap-3 font-body2 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-800" />
            or
            <span className="h-px flex-1 bg-slate-800" />
          </div>
          <a
            href={GITHUB_LOGIN_URL}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-8 py-3 font-body2 text-sm font-semibold text-slate-100 transition hover:border-indigo-500 hover:bg-slate-700"
          >
            <GithubIcon className="h-4 w-4" />
            Continue with GitHub
          </a>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isRegistering ? 'register-help' : 'login-help'}
              className="mt-4 space-y-2 text-center"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <button
                type="button"
                onClick={() => {
                  setIsRegistering((current) => !current);
                  setError('');
                }}
                className="font-body2 text-sm font-medium text-indigo-400 transition hover:text-indigo-300"
              >
                {isRegistering ? 'Already have an account? Sign in' : 'Don\'t have an account? Sign up'}
              </button>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
