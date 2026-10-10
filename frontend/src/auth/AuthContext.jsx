// Holds the signed-in user for the whole app.
//
// On first load it checks for a stored token and asks the API who it belongs
// to (GET /auth/me). Until that answer comes back, status is 'loading' so
// protected pages don't flash the Sign-In screen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { SESSION_EXPIRED_EVENT } from '../api/client';
import { getToken, setToken, clearToken } from './tokenStorage';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // 'loading' | 'authenticated' | 'anonymous'
  const [status, setStatus] = useState(() => (getToken() ? 'loading' : 'anonymous'));
  // Shown once on the Sign-In screen after a forced logout.
  const [notice, setNotice] = useState(null);

  // Restore an existing session on page load.
  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    api.get('/auth/me')
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setUser(null);
        setStatus('anonymous');
      });
    return () => { cancelled = true; };
  }, [status]);

  // The axios interceptor fires this when any request comes back 401.
  useEffect(() => {
    const onExpired = (event) => {
      setUser(null);
      setStatus('anonymous');
      setNotice(event.detail || 'Your session has expired. Please sign in again.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Throws on failure so the Sign-In form can show the error.
  const login = useCallback(async (email, password, remember) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token, remember);
    setUser(data.user);
    setStatus('authenticated');
    setNotice(null);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({ user, status, notice, login, logout, clearNotice }),
    [user, status, notice, login, logout, clearNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
