import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { TOKEN_KEY, login as apiLogin, register as apiRegister, getMe } from '../api/client';
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
