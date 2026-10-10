import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

// const { user, status, login, logout } = useAuth();
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
