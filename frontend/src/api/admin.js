// Admin API calls for User Management and the Audit Log (Phase 4a).
// Each returns the response body; errors propagate to the caller, which
// shows them with getErrorMessage().
import api from './client';

export const inviteUser = (body) => api.post('/users', body).then((r) => r.data);

export const updateUser = (id, changes) => api.patch(`/users/${id}`, changes).then((r) => r.data);

export const issueSetupLink = (id) => api.post(`/users/${id}/setup-link`).then((r) => r.data);

export const deactivateUser = (id) => api.post(`/users/${id}/deactivate`).then((r) => r.data);

export const reactivateUser = (id) => api.post(`/users/${id}/reactivate`).then((r) => r.data);

export const getUser = (id) => api.get(`/users/${id}`).then((r) => r.data);

// Public set-password flow (no sign-in needed)
export const verifySetupLink = (token) => api.post('/auth/setup/verify', { token }).then((r) => r.data);

export const completeSetup = (token, password) => api.post('/auth/setup', { token, password }).then((r) => r.data);
