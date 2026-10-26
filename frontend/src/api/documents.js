// SOP library API calls (Phase 5: FR13). The list is read with
// useFetch('/documents'); these are the writes, plus opening a cited SOP.
import api from './client';

// Largest upload the backend accepts (SOP_MAX_MB there). Only used to warn
// early; the server enforces its own limit.
export const SOP_MAX_MB = Number(import.meta.env.VITE_SOP_MAX_MB) || 20;
export const SOP_EXTENSIONS = ['pdf', 'docx', 'txt'];

const UPLOAD_OPTIONS = { timeout: 0 };

function toFormData(title, file) {
  const form = new FormData();
  if (title) form.append('title', title);
  if (file) form.append('file', file);
  return form;
}

// Both answer 202 with status 'processing'; indexing continues on the server.
export const uploadDocument = (title, file, onProgress) => api
  .post('/documents', toFormData(title, file), { ...UPLOAD_OPTIONS, onUploadProgress: onProgress })
  .then((r) => r.data.document);

export const updateDocument = (id, title, file, onProgress) => api
  .put(`/documents/${id}`, toFormData(title, file), { ...UPLOAD_OPTIONS, onUploadProgress: onProgress })
  .then((r) => r.data.document);

export const reindexDocument = (id) => api.post(`/documents/${id}/reindex`).then((r) => r.data.document);

export const deleteDocument = (id) => api.delete(`/documents/${id}`);

// Opens an SOP through the API (it needs the Bearer token, so a plain link
// would be rejected). The tab is opened before the request, while the click
// still counts as the user's, otherwise pop-up blockers stop it.
// PDFs show in the browser's viewer; other types download.
export async function openDocument(docId) {
  const tab = window.open('', '_blank');
  try {
    const response = await api.get(`/documents/${docId}/file`, { responseType: 'blob', timeout: 0 });
    const blobUrl = URL.createObjectURL(response.data);
    if (tab) tab.location.href = blobUrl;
    else window.location.assign(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (err) {
    tab?.close();
    // With responseType 'blob' the JSON error body arrives as a Blob too.
    if (err.response?.data instanceof Blob) {
      try { err.response.data = JSON.parse(await err.response.data.text()); } catch { /* keep as is */ }
    }
    throw err;
  }
}
