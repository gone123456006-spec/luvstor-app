/**
 * Nightly chat nudge — one WhatsApp-style push per user at NIGHTLY_NUDGE_HOUR
 * (default 22:00 local, see DAILY_SUGGESTION_TZ_OFFSET_MINUTES).
 *
 * People with unread chats get a real "X is waiting for your reply" line;
 * everyone else gets copy for that weekday, rotated week to week. The
 * `nightly:<day>` dedupe key keeps it to one per user per night across restarts
 * and instances. It has its own daily slot, so it neither counts against nor
 * is blocked by the weekly auto-notification budget used by digests.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const { createPersonalNotifications } = require('../services/notifications');

const ENABLED = process.env.NIGHTLY_NUDGE_ENABLED !== 'false';
const SEND_HOUR = clampInt(process.env.NIGHTLY_NUDGE_HOUR, 22, 0, 23);
const TZ_OFFSET_MINUTES = clampInt(process.env.DAILY_SUGGESTION_TZ_OFFSET_MINUTES, 0, -720, 840);
const ACTIVE_WITHIN_DAYS = clampInt(process.env.NIGHTLY_NUDGE_ACTIVE_DAYS, 30, 1, 365);
/** Someone using the app right now doesn't need a nudge to open it */
const SKIP_IF_SEEN_MINUTES = 10;

const PAGE_SIZE = 500;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function shifted(now) {
  return new Date(now.getTime() + TZ_OFFSET_MINUTES * MINUTE_MS);
}

function localHour(now = new Date()) {
  return shifted(now).getUTCHours();
}

function nudgeDayKey(now = new Date()) {
  return shifted(now).toISOString().slice(0, 10);
}

function isSendWindow(now = new Date()) {
  return localHour(now) === SEND_HOUR;
}

/** Index 0 = Sunday … 6 = Saturday; several lines per day, rotated weekly */
const DAY_MESSAGES = [
  [
    { title: 'Sunday night chats hit different 🌙', body: 'Someone on Luvstor is up for a chat. Say hi 💬' },
    { title: 'Lazy Sunday? 😌', body: 'Perfect time for a good conversation. People are online now 💬' },
    { title: 'Before the week starts…', body: 'Someone could be waiting for your hello. Open Luvstor 💜' },
  ],
  [
    { title: 'Monday done ✅', body: 'Unwind with a chat — someone on Luvstor is waiting to talk 💬' },
    { title: 'New week, new people 👋', body: 'Fresh faces joined near you. Start a chat tonight 💬' },
    { title: 'Long Monday? 😮‍💨', body: 'A good chat fixes it. Someone is online on Luvstor 💜' },
  ],
  [
    { title: 'Tuesday night check-in 💬', body: 'Someone might be waiting for your message. Open Luvstor' },
    { title: 'Got 5 minutes? ⏳', body: 'That’s all it takes to start something new. Say hi tonight 👋' },
    { title: 'Your chats miss you 🥺', body: 'People are online right now on Luvstor 💬' },
  ],
  [
    { title: 'Halfway through the week 🎉', body: 'Celebrate with a chat — someone is waiting on Luvstor 💬' },
    { title: 'Midweek mood: chatty 😄', body: 'See who’s online near you and say hi 👋' },
    { title: 'Wednesday vibes ✨', body: 'Someone could be your next favourite conversation 💜' },
  ],
  [
    { title: 'Almost Friday 😍', body: 'Make weekend plans with someone new. Open Luvstor 💬' },
    { title: 'Thursday night talk? 🌙', body: 'Someone on Luvstor is waiting for your chat 💬' },
    { title: 'Don’t leave them on seen 👀', body: 'Your conversations are waiting on Luvstor 💬' },
  ],
  [
    { title: 'Friday night! 🎉', body: 'Someone is waiting for your chat on Luvstor 💬' },
    { title: 'Weekend starts now 🥳', body: 'Find someone to talk to tonight. Open Luvstor 💜' },
    { title: 'Friday feels 💃', body: 'People near you are online. Say hi 👋' },
  ],
  [
    { title: 'Saturday night plans? 🌃', body: 'Start with a chat — someone on Luvstor is waiting 💬' },
    { title: 'Weekend chats 💜', body: 'Who knows where one hello can lead? Open Luvstor 👋' },
    { title: 'Saturday mood: social 😎', body: 'People are online near you right now 💬' },
  ],
];

function weekIndex(now) {
  return Math.floor(shifted(now).getTime() / (7 * DAY_MS));
}

/** Day-themed copy; rotates per week so the same weekday doesn't repeat */
function dayMessage(now = new Date()) {
  const options = DAY_MESSAGES[shifted(now).getUTCDay()];
  return options[weekIndex(now) % options.length];
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0].slice(0, 30);
}

/**
 * @param {{ chats: number, messages: number, senderName?: string }|null} unread
 */
function composeNudge(unread, now = new Date()) {
  if (unread && unread.chats > 0) {
    if (unread.chats === 1 && unread.senderName) {
      return {
        title: `${unread.senderName} is waiting for your reply 💬`,
        body:
          unread.messages > 1
            ? `${unread.messages} unread messages on Luvstor. Tap to reply.`
            : 'You have an unread message on Luvstor. Tap to reply.',
        deepLink: '/(tabs)/chat',
      };
    }
    return {
      title: `${unread.chats} people are waiting for your reply 💬`,
      body: `${unread.messages} unread messages on Luvstor. Tap to catch up.`,
      deepLink: '/(tabs)/chat',
    };
  }
  return { ...dayMessage(now), deepLink: '/(tabs)' };
}

/** Unread chats per user for a page of ids, plus the sender name when it's one chat */
async function collectUnread(userIds) {
  const result = new Map();
  if (!userIds.length) return result;

  const rows = await Message.aggregate([
    {
      $match: {
        receiverId: { $in: userIds },
        read: false,
        isDeleted: { $ne: true },
      },
    },
    { $match: { $expr: { $not: { $in: ['$receiverId', { $ifNull: ['$deletedFor', []] }] } } } },
    { $group: { _id: '$receiverId', messages: { $sum: 1 }, senders: { $addToSet: '$senderId' } } },
  ]);

  const singleSenders = rows.filter((r) => r.senders.length === 1).map((r) => r.senders[0]);
  const names = new Map();
  if (singleSenders.length) {
    const senders = await User.find({ _id: { $in: singleSenders }, isDeactivated: { $ne: true } })
      .select('_id name')
      .lean();
    senders.forEach((s) => names.set(String(s._id), firstName(s.name)));
  }

  for (const r of rows) {
    result.set(String(r._id), {
      chats: r.senders.length,
      messages: r.messages,
      senderName: r.senders.length === 1 ? names.get(String(r.senders[0])) : undefined,
    });
  }
  return result;
}

/**
 * @param {import('socket.io').Server|null} io
 * @param {{ now?: Date, force?: boolean }} [options] `force` skips the hour check
 */
async function sendNightlyNudges(io, { now = new Date(), force = false } = {}) {
  const stats = { scanned: 0, created: 0, pushed: 0, skipped: null };
  if (!ENABLED) return { ...stats, skipped: 'disabled' };
  if (!force && !isSendWindow(now)) return { ...stats, skipped: 'outside-send-window' };

  const dayKey = nudgeDayKey(now);
  const activeSince = new Date(now.getTime() - ACTIVE_WITHIN_DAYS * DAY_MS);
  const onlineSince = new Date(now.getTime() - SKIP_IF_SEEN_MINUTES * MINUTE_MS);
  let cursor = null;

  for (;;) {
    const filter = {
      isVerified: true,
      isDeactivated: { $ne: true },
      deletionScheduledAt: null,
      name: { $nin: [null, ''] },
      lastSeen: { $gte: activeSince, $lt: onlineSince },
      'notificationPrefs.promotions': { $ne: false },
    };
    if (cursor) filter._id = { $gt: cursor };

    const page = await User.find(filter).select('_id').sort({ _id: 1 }).limit(PAGE_SIZE).lean();
    if (!page.length) break;
    cursor = page[page.length - 1]._id;
    stats.scanned += page.length;

    const ids = page.map((u) => new mongoose.Types.ObjectId(String(u._id)));
    const unread = await collectUnread(ids);

    const items = page.map((u) => {
      const id = String(u._id);
      const waiting = unread.get(id) || null;
      const msg = composeNudge(waiting, now);
      return {
        userId: id,
        title: msg.title,
        body: msg.body,
        deepLink: msg.deepLink,
        dedupeKey: `nightly:${dayKey}`,
        data: { code: 'NIGHTLY_NUDGE', day: dayKey, unread: String(waiting?.messages || 0) },
      };
    });

    const result = await createPersonalNotifications(io, items, {
      type: 'suggestion',
      groupKey: 'nightly-nudge',
      channelId: 'nightly',
      priority: 'high',
    });
    stats.created += result.created;
    stats.pushed += result.pushed;

    if (page.length < PAGE_SIZE) break;
  }

  console.log(
    `[nightlyNudge] ${dayKey}: scanned ${stats.scanned}, sent ${stats.created}, pushed ${stats.pushed}`,
  );
  return stats;
}

let lastRunDayKey = null;

/** Scheduler entry point; cheap outside the send hour and once per day per process */
async function runNightlyNudgeIfDue(io, now = new Date()) {
  if (!ENABLED) return { skipped: 'disabled' };
  if (!isSendWindow(now)) return { skipped: 'outside-send-window' };

  const dayKey = nudgeDayKey(now);
  if (lastRunDayKey === dayKey) return { skipped: 'already-ran-today' };
  lastRunDayKey = dayKey;

  try {
    return await sendNightlyNudges(io, { now, force: true });
  } catch (err) {
    lastRunDayKey = null;
    console.error('[nightlyNudge] run failed:', err?.message || err);
    return { skipped: 'error', error: err?.message || String(err) };
  }
}

module.exports = {
  sendNightlyNudges,
  runNightlyNudgeIfDue,
  composeNudge,
  dayMessage,
  nudgeDayKey,
  isSendWindow,
  DAY_MESSAGES,
  SEND_HOUR,
};
