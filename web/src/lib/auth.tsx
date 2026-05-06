import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from './api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>;
  register: (email: string, password: string, name?: string, turnstileToken?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setUser(null);
        return;
      }
      const data = await api.getProfile();
      setUser(data.user ?? data);
    } catch {
      setUser(null);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = async (email: string, password: string, turnstileToken?: string) => {
    const data = await api.login(email, password, turnstileToken);
    if (data.requiresTwoFactor) {
      // TODO: implement 2FA flow
      throw new Error('Two-factor authentication required');
    }
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    setUser(data.user);
  };

  const register = async (email: string, password: string, name?: string, turnstileToken?: string) => {
    await api.register(email, password, name, turnstileToken);
    await login(email, password, turnstileToken);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
