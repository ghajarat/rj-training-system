// AI Assistant API calls (Phase 5: FR10–FR12). The session list is read
// with useFetch('/chat/sessions'); these are the other calls.
import api from './client';

// An answer can take a few seconds, and the server retries a slow AI service
// once or twice, so allow more than the default 15 s.
const ASK_OPTIONS = { timeout: 60000 };

export const QUESTION_MAX = 2000;

export const createSession = () => api.post('/chat/sessions').then((r) => r.data.session);

export const deleteSession = (id) => api.delete(`/chat/sessions/${id}`);

// → { session, messages }
export const getMessages = (id) => api.get(`/chat/sessions/${id}/messages`).then((r) => r.data);

// → { userMessage, message, citations, relatedCourses, session, timings }
export const sendMessage = (sessionId, text) => api
  .post(`/chat/sessions/${sessionId}/messages`, { text }, ASK_OPTIONS)
  .then((r) => r.data);
