/**
 * Budget for automatic notifications (digests, reminders) — never for
 * event notifications like messages, calls, likes or matches.
 *
 * Every user gets at most AUTO_NOTIFS_PER_WEEK automatic pushes in any rolling
 * 7 days, at least AUTO_NOTIFS_MIN_GAP_HOURS apart, and none during quiet
 * hours (local time, see DAILY_SUGGESTION_TZ_OFFSET_MINUTES).
 */
const mongoose = require('mongoose');
const AutoNotificationLog = require('../models/AutoNotificationLog');

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const MAX_PER_WEEK = clampInt(process.env.AUTO_NOTIFS_PER_WEEK, 3, 0, 14);
const MIN_GAP_HOURS = clampInt(process.env.AUTO_NOTIFS_MIN_GAP_HOURS, 36, 0, 168);
const QUIET_START_HOUR = clampInt(process.env.AUTO_NOTIFS_QUIET_START, 22, 0, 23);
const QUIET_END_HOUR = clampInt(process.env.AUTO_NOTIFS_QUIET_END, 9, 0, 23);
const TZ_OFFSET_MINUTES = clampInt(process.env.DAILY_SUGGESTION_TZ_OFFSET_MINUTES, 0, -720, 840);

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

function localHour(now = new Date()) {
  return new Date(now.getTime() + TZ_OFFSET_MINUTES * 60 * 1000).getUTCHours();
}

/** True between QUIET_START_HOUR and QUIET_END_HOUR local time. */
function isQuietHours(now = new Date()) {
  const h = localHour(now);
  return QUIET_START_HOUR > QUIET_END_HOUR
    ? h >= QUIET_START_HOUR || h < QUIET_END_HOUR
    : h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
}

/**
 * Which of `userIds` may receive an automatic notification right now.
 * @returns {Promise<Set<string>>}
 */
async function filterWithinBudget(userIds, now = new Date()) {
  const ids = [...new Set(userIds.map(String))].filter((id) =>
    mongoose.isValidObjectId(id),
  );
  if (!ids.length || MAX_PER_WEEK === 0) return new Set();

  const rows = await AutoNotificationLog.aggregate([
    {
      $match: {
        userId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        createdAt: { $gte: new Date(now.getTime() - WEEK_MS) },
      },
    },
    { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
  ]);

  const blocked = new Set();
  for (const r of rows) {
    const tooMany = r.count >= MAX_PER_WEEK;
    const tooSoon = now.getTime() - new Date(r.lastAt).getTime() < MIN_GAP_HOURS * HOUR_MS;
    if (tooMany || tooSoon) blocked.add(String(r._id));
  }
  return new Set(ids.filter((id) => !blocked.has(id)));
}

async function canSendAuto(userId, now = new Date()) {
  if (isQuietHours(now)) return false;
  const allowed = await filterWithinBudget([userId], now);
  return allowed.has(String(userId));
}

async function recordAutoSent(userIds, code, now = new Date()) {
  const docs = [...new Set(userIds.map(String))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => ({ userId: id, code, createdAt: now }));
  if (!docs.length) return;
  try {
    await AutoNotificationLog.insertMany(docs, { ordered: false });
  } catch (err) {
    console.warn('[autoNotifications] log failed:', err?.message || err);
  }
}

module.exports = {
  MAX_PER_WEEK,
  MIN_GAP_HOURS,
  isQuietHours,
  filterWithinBudget,
  canSendAuto,
  recordAutoSent,
};
