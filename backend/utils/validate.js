// Small input helpers shared by the routes. The backend validates every
// request itself, even when the frontend has already checked it.
const HttpError = require('./httpError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Throws 400 for a malformed id, so a bad URL never reaches PostgreSQL
// (which would answer with a 500 "invalid input syntax for type uuid").
function requireUuid(value, what = 'id') {
  if (!isUuid(value)) {
    throw new HttpError(400, 'VALIDATION', `The ${what} is not valid.`);
  }
  return value;
}

// ?page=2&pageSize=20 → { page, pageSize, offset }
function parsePagination(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? defaultSize : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) {
    throw new HttpError(400, 'VALIDATION', 'page must be a whole number of 1 or more.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxSize) {
    throw new HttpError(400, 'VALIDATION', `pageSize must be between 1 and ${maxSize}.`);
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function paginationDto({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Escapes % and _ so a search for "50%" matches the text "50%", not everything.
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

// A real calendar date in YYYY-MM-DD form. The round trip matters:
// JavaScript quietly turns "2026-02-30" into 2 March, which PostgreSQL
// would then reject with a 500. Here it is a 400.
function isDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Trimmed text with collapsed spaces, length-checked. `label` is used in the
// error message, e.g. readText(body.name, 'Course name', { min: 2, max: 150 }).
function readText(value, label, { min = 1, max }) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < min || text.length > max) {
    throw new HttpError(400, 'VALIDATION', min > 1
      ? `${label} must be between ${min} and ${max} characters.`
      : `${label} is required and must be at most ${max} characters.`);
  }
  return text;
}

// An absolute http(s) URL. Anything else (javascript:, file:, relative paths)
// is rejected, because the frontend renders it as a clickable link.
function readHttpUrl(value, label = 'Link') {
  const text = typeof value === 'string' ? value.trim() : '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, 'VALIDATION', `${label} must be a full web address starting with https://.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || text.length > 500) {
    throw new HttpError(400, 'VALIDATION', `${label} must be a web address (http or https) of at most 500 characters.`);
  }
  return text;
}

module.exports = {
  EMAIL_RE, isUuid, requireUuid, parsePagination, paginationDto, likePattern, isDate,
  readText, readHttpUrl,
};
