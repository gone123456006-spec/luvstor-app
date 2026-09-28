const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Express 5 forwards rejected promises, but keep one wrapper for clarity. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isObjectId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

function toObjectId(value) {
  if (!isObjectId(String(value || ''))) throw new HttpError(400, 'Invalid id', 'BAD_ID');
  return new mongoose.Types.ObjectId(String(value));
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pageParams(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(Math.max(Math.floor(Number(query.limit) || defaultLimit), 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function oneOf(value, allowed, fallback) {
  const v = String(value ?? '').trim();
  return allowed.includes(v) ? v : fallback;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Fill a [{_id:'YYYY-MM-DD', count}] aggregation into a continuous day series. */
function fillDaySeries(rows, days, valueKey = 'count') {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  const today = startOfUtcDay();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    out.push({ date: key, value: row ? Number(row[valueKey]) || 0 : 0 });
  }
  return out;
}

module.exports = {
  HttpError,
  asyncHandler,
  isObjectId,
  toObjectId,
  escapeRegex,
  pageParams,
  cleanText,
  oneOf,
  daysAgo,
  startOfUtcDay,
  fillDaySeries,
};
