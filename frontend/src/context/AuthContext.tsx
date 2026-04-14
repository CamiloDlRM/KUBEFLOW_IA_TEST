import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { TOKEN_KEY, login as apiLogin, register as apiRegister, getMe } from '../api/client';
import type { LoginPayload, RegisterPayload, UserResponse } from '../types';

interface AuthContextValue {
  token: string | null;
  currentUser: UserResponse | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null);

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

  const login = useCallback(async (payload: LoginPayload) => {
    const res = await apiLogin(payload);
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    await apiRegister(payload);
    await login({ username: payload.username, password: payload.password });
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCurrentUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        currentUser,
        isAuthenticated: !!token,
        isAdmin: currentUser?.role === 'admin',
        login,
        register,
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
