// Shared axios instance. Every API call goes through this so the JWT is
// attached automatically and expired sessions are handled in one place.
//
//   import api, { getErrorMessage } from '../api/client';
//   const { data } = await api.get('/users');
import axios from 'axios';
import { getToken, clearToken } from '../auth/tokenStorage';

export const SESSION_EXPIRED_EVENT = 'rj:session-expired';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 15000,
});

// Request: attach "Authorization: Bearer <token>"
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response: a 401 on any call other than the login itself means the token is
// expired or invalid. Drop it and tell AuthContext to send the user to Sign-In.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const isLoginCall = error.config?.url?.includes('/auth/login');
    if (status === 401 && !isLoginCall && getToken()) {
      clearToken();
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, {
        detail: error.response?.data?.error?.message,
      }));
    }
    return Promise.reject(error);
  },
);

// Turns any axios error into a sentence that can be shown to the user (NFR12).
export function getErrorMessage(error) {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  if (error.code === 'ECONNABORTED') {
    return 'The server took too long to respond. Please try again.';
  }
  if (!error.response) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default api;
