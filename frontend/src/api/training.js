// Training management API calls (Phase 4b): courses and materials (FR7),
// plans and assignments (FR8). Reads use useFetch; these are the writes.
// Each returns the response body; errors propagate to the caller, which
// shows them with getErrorMessage().
import api from './client';

// Largest upload the backend accepts (MATERIAL_MAX_MB there). Only used to
// warn early; the server enforces its own limit.
export const MATERIAL_MAX_MB = Number(import.meta.env.VITE_MATERIAL_MAX_MB) || 100;
export const MATERIAL_EXTENSIONS = ['pdf', 'docx', 'pptx', 'mp4'];

// A large video can take longer than the default 15 s timeout.
const UPLOAD_OPTIONS = { timeout: 0 };

// fields: { planId?, name, durationMinutes, link }, file: File | null
// Sent as multipart/form-data so the file travels with the fields.
function toFormData(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value ?? '');
  }
  if (file) form.append('file', file);
  return form;
}

export const createCourse = (fields, file, onProgress) => api
  .post('/courses', toFormData(fields, file), { ...UPLOAD_OPTIONS, onUploadProgress: onProgress })
  .then((r) => r.data);

export const updateCourse = (id, fields, file, onProgress) => api
  .patch(`/courses/${id}`, toFormData(fields, file), { ...UPLOAD_OPTIONS, onUploadProgress: onProgress })
  .then((r) => r.data);

export const deleteCourse = (id) => api.delete(`/courses/${id}`);

// Downloads a stored material through the API (it needs the Bearer token,
// so a plain <a href> would be rejected), then hands it to the browser.
export async function downloadMaterial(course) {
  let response;
  try {
    response = await api.get(`/courses/${course.id}/material`, { responseType: 'blob', ...UPLOAD_OPTIONS });
  } catch (err) {
    // With responseType 'blob' the JSON error body arrives as a Blob too.
    if (err.response?.data instanceof Blob) {
      try { err.response.data = JSON.parse(await err.response.data.text()); } catch { /* keep as is */ }
    }
    throw err;
  }
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${course.name}.${course.material.type}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const createPlan = (body) => api.post('/plans', body).then((r) => r.data);

export const updatePlan = (id, changes) => api.patch(`/plans/${id}`, changes).then((r) => r.data);

export const deletePlan = (id) => api.delete(`/plans/${id}`);

export const reorderCourses = (planId, courseIds) => api
  .put(`/plans/${planId}/order`, { courseIds })
  .then((r) => r.data);

// body: { traineeIds: [...] } or { departmentId }
export const assignPlan = (planId, body) => api
  .post(`/plans/${planId}/assignments`, body)
  .then((r) => r.data);

export const unassignTrainee = (planId, traineeId) => api.delete(`/plans/${planId}/assignments/${traineeId}`);
