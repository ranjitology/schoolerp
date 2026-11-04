import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  refreshSession,
  setAccessToken,
  setTenantSlug,
  setUnauthorizedHandler,
} from './api';
import type { AuthUser, LoginResponse } from './types';

export interface LoginInput {
  schoolSlug: string;
  email: string;
  password: string;
  totpCode?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUnauthorizedHandler(() => setUser(null));
    void (async () => {
      try {
        const session = await refreshSession<LoginResponse>();
        if (!cancelled && session) {
          setAccessToken(session.accessToken);
          setUser(session.user);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    setTenantSlug(input.schoolSlug);
    const result = await api.post<LoginResponse>('/auth/login', {
      schoolSlug: input.schoolSlug,
      email: input.email,
      password: input.password,
      ...(input.totpCode ? { totpCode: input.totpCode } : {}),
    });
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // A network failure must not trap the user in the app.
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, hasPermission }),
    [user, loading, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
