// A trainee's own training (Phase 4c): /api/me on the backend.
// Reads go through useMyTraining(); these are the writes. Both writes answer
// with the refreshed { summary, plans }, so the caller can show the new
// numbers without a second request.
import api from './client';
import { downloadMaterial } from './training';

// The backend accepts exactly these steps (decision 1): 0 = started,
// 25/50/75 = in progress, 100 = completed.
export const PROGRESS_STEPS = [0, 25, 50, 75, 100];
export const COMMENT_MAX = 2000;

// FR5
export const setProgress = (courseId, completionPct) => api
  .put(`/me/courses/${courseId}/progress`, { completionPct })
  .then((r) => r.data);

// FR6: creates or edits my one feedback on this course.
export const saveFeedback = (courseId, { rating, comment }) => api
  .put(`/me/courses/${courseId}/feedback`, { rating, comment })
  .then((r) => r.data);

// FR4: only works for courses in my assigned plans (checked by the server).
export const downloadMyMaterial = (course) => downloadMaterial(course, `/me/courses/${course.id}/material`);
