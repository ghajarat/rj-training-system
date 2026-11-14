// Phase 8 (FR17): report export. The preview itself is a plain GET
// (useFetch('/reports/:id', filters)); only the file download needs this.
import api from './client';

// Building a long PDF can take a few seconds on a big cohort.
const EXPORT_TIMEOUT_MS = 60000;

// "attachment; filename=\"rj-roi-2026-11-14.pdf\"" → "rj-roi-2026-11-14.pdf"
function fileNameFrom(disposition, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(disposition || '');
  return match ? match[1] : fallback;
}

// Downloads the report as a file. format: 'pdf' | 'csv'.
// The request carries the token (an <a href> could not), so the file is
// fetched as a blob and then handed to the browser.
export async function downloadReport(id, format, filters = {}) {
  let response;
  try {
    response = await api.get(`/reports/${id}/export`, {
      params: { ...filters, format },
      responseType: 'blob',
      timeout: EXPORT_TIMEOUT_MS,
    });
  } catch (err) {
    // With responseType 'blob' the JSON error body arrives as a Blob too.
    if (err.response?.data instanceof Blob) {
      try { err.response.data = JSON.parse(await err.response.data.text()); } catch { /* keep as is */ }
    }
    throw err;
  }
  const blobUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileNameFrom(response.headers['content-disposition'], `rj-${id}.${format}`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}
