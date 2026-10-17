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

function isDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

module.exports = {
  EMAIL_RE, isUuid, requireUuid, parsePagination, paginationDto, likePattern, isDate,
};
