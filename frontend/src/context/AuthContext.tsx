import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { TOKEN_KEY, login as apiLogin, register as apiRegister, getMe, refreshToken } from '../api/client';

/** How often an active session trades its token for a fresh one. Well under the token's 60-minute life. */
export const REFRESH_EVERY_MS = 5 * 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
import type { GithubTokenStatus, LoginPayload, RegisterPayload, UserResponse } from '../types';

interface AuthContextValue {
  token: string | null;
  currentUser: UserResponse | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  githubTokenStatus: GithubTokenStatus;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  /** Adopt a JWT obtained elsewhere (GitHub OAuth). */
  acceptToken: (accessToken: string, status?: GithubTokenStatus) => void;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null);
  const [githubTokenStatus, setGithubTokenStatus] = useState<GithubTokenStatus>('unknown');

  // Fetch current user profile whenever token changes
  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      return;
    }
    getMe()
      .then(setCurrentUser)
      .catch(() => {
        // Token invalid/expired — clear it
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setCurrentUser(null);
      });
  }, [token]);

  // Sliding session: renew the token only if the user did something since the
  // last renewal, so it ends after an hour without activity, not an hour after sign-in.
  useEffect(() => {
    if (!token) return;
    let active = false;
    const markActive = () => {
      active = true;
    };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (!active) return;
      active = false;
      // Only localStorage: every request reads it there, and other tabs see it too.
      // A failure is left to the next request, whose 401 sends the user to /login.
      refreshToken()
        .then((res) => localStorage.setItem(TOKEN_KEY, res.access_token))
        .catch(() => {});
    }, REFRESH_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive));
      window.clearInterval(timer);
    };
  }, [token]);

  const acceptToken = useCallback((accessToken: string, status: GithubTokenStatus = 'unknown') => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    setToken(accessToken);
    setGithubTokenStatus(status);
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const res = await apiLogin(payload);
    acceptToken(res.access_token, res.github_token_status);
  }, [acceptToken]);

  const register = useCallback(async (payload: RegisterPayload) => {
    const user = await apiRegister(payload);
    // The server adds the "@t" suffix, so sign in with the name it returned.
    await login({ username: user.username, password: payload.password });
  }, [login]);

  const refreshUser = useCallback(async () => {
    setCurrentUser(await getMe());
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCurrentUser(null);
    setGithubTokenStatus('unknown');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        currentUser,
        isAuthenticated: !!token,
        isAdmin: currentUser?.role === 'admin',
        githubTokenStatus,
        login,
        register,
        acceptToken,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
