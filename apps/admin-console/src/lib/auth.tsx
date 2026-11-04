import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken, setUnauthorizedHandler } from './api';
import type { PlatformLoginResponse, PlatformUser } from './types';

const TOKEN_KEY = 'erp.platformToken';

interface AuthContextValue {
  user: PlatformUser | null;
  loading: boolean;
  login: (input: { email: string; password: string; totpCode?: string }) => Promise<PlatformUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUnauthorizedHandler(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      setAccessToken(null);
      setUser(null);
    });

    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    setAccessToken(stored);
    void (async () => {
      try {
        const me = await api.get<PlatformUser>('/platform/me');
        if (!cancelled) setUser(me);
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
        setAccessToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string; totpCode?: string }) => {
      const result = await api.post<PlatformLoginResponse>('/platform/auth/login', input);
      sessionStorage.setItem(TOKEN_KEY, result.accessToken);
      setAccessToken(result.accessToken);
      setUser(result.user);
      return result.user;
    },
    [],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
