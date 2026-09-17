import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { authApi, AuthUser, setAuthToken } from "../lib/api";

const TOKEN_KEY = "leafnet.token";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; user?: AuthUser; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Restore an existing token from localStorage, then validate it. */
async function bootstrapAuth(): Promise<{ user: AuthUser | null }> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { user: null };
  setAuthToken(token);
  const user = await authApi.me().catch(() => null);
  if (!user) {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
  }
  return { user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    bootstrapAuth().then(({ user: u }) => {
      if (cancelled) return;
      setUser(u);
      setLoading(false);
    });
    const onUnauthorized = () => {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken(null);
      setUser(null);
    };
    window.addEventListener("leafnet:unauthorized", onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("leafnet:unauthorized", onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authApi.login(email, password);
    if (!r.ok) return { ok: false, error: r.error };
    localStorage.setItem(TOKEN_KEY, r.token);
    setAuthToken(r.token);
    setUser(r.user);
    return { ok: true, user: r.user };
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}