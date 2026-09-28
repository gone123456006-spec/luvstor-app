const express = require('express');
const { User, Call, Friendship, Message, ProfileView, ShortLink } = require('../models/app');
const { asyncHandler, daysAgo, startOfUtcDay, fillDaySeries } = require('../lib/http');
const { cached } = require('../lib/cache');
const { loadUserRefs } = require('../lib/users');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('engagement.view'));
const MAX_MS = 30_000;
const DAY = 86_400_000;

function clampDays(value, fallback = 30) {
  return Math.min(Math.max(Math.floor(Number(value) || fallback), 1), 90);
}

/**
 * Weekly signup cohorts. "Returned after N days" = lastSeen is at least N days
 * after signup (the app has no per-day activity log, so this is the best
 * available retention signal). Values are null until the cohort is old enough.
 */
router.get(
  '/retention',
  asyncHandler(async (req, res) => {
    const weeks = Math.min(Math.max(Math.floor(Number(req.query.weeks) || 8), 1), 26);
    const data = await cached(`eng:retention:${weeks}`, 10 * 60_000, async () => {
      const start = new Date(startOfUtcDay().getTime() - weeks * 7 * DAY);
      const rows = await User.aggregate([
        { $match: { createdAt: { $gte: start } } },
        {
          $project: {
            week: { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday' } },
            gap: { $subtract: [{ $ifNull: ['$lastSeen', '$createdAt'] }, '$createdAt'] },
            completed: { $cond: [{ $eq: ['$profileCompleted', true] }, 1, 0] },
          },
        },
        {
          $group: {
            _id: '$week',
            size: { $sum: 1 },
            completed: { $sum: '$completed' },
            d1: { $sum: { $cond: [{ $gte: ['$gap', DAY] }, 1, 0] } },
            d7: { $sum: { $cond: [{ $gte: ['$gap', 7 * DAY] }, 1, 0] } },
            d30: { $sum: { $cond: [{ $gte: ['$gap', 30 * DAY] }, 1, 0] } },
          },
        },
        { $sort: { _id: -1 } },
      ]).option({ maxTimeMS: MAX_MS });
      const now = Date.now();
      return {
        cohorts: rows.map((r) => {
          const weekEnd = new Date(r._id).getTime() + 7 * DAY;
          const ready = (n) => weekEnd + n * DAY <= now;
          return {
            week: new Date(r._id).toISOString().slice(0, 10),
            size: r.size,
            profileCompleted: r.completed,
            d1: ready(1) ? r.d1 : null,
            d7: ready(7) ? r.d7 : null,
            d30: ready(30) ? r.d30 : null,
          };
        }),
      };
    });
    res.json(data);
  }),
);

router.get(
  '/funnel',
  asyncHandler(async (req, res) => {
    const days = clampDays(req.query.days);
    const data = await cached(`eng:funnel:${days}`, 10 * 60_000, async () => {
      const since = daysAgo(days);
      const [signups, completed, profileViews, likes, matches, convo] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: since } }).maxTimeMS(MAX_MS),
        User.countDocuments({ createdAt: { $gte: since }, profileCompleted: true }).maxTimeMS(MAX_MS),
        ProfileView.countDocuments({ firstViewedAt: { $gte: since } }).maxTimeMS(MAX_MS),
        Friendship.countDocuments({ likedAt: { $gte: since } }).maxTimeMS(MAX_MS),
        Friendship.countDocuments({ matchedAt: { $gte: since } }).maxTimeMS(MAX_MS),
        Message.aggregate([
          { $match: { createdAt: { $gte: since }, type: { $ne: 'call' } } },
          { $group: { _id: '$roomId', senders: { $addToSet: '$senderId' } } },
          {
            $group: {
              _id: null,
              conversations: { $sum: 1 },
              replied: { $sum: { $cond: [{ $gte: [{ $size: '$senders' }, 2] }, 1, 0] } },
            },
          },
        ]).option({ maxTimeMS: MAX_MS }),
      ]);
      const c = convo[0] || { conversations: 0, replied: 0 };
      return {
        days,
        steps: [
          { key: 'signups', label: 'Signups', value: signups },
          { key: 'profileCompleted', label: 'Finished profile setup', value: completed },
          { key: 'profileViews', label: 'Profile views', value: profileViews },
          { key: 'likes', label: 'Likes sent', value: likes },
          { key: 'matches', label: 'Matches', value: matches },
          { key: 'conversations', label: 'Conversations', value: c.conversations },
          { key: 'replied', label: 'Conversations with a reply', value: c.replied },
        ],
      };
    });
    res.json(data);
  }),
);

router.get(
  '/calls',
  asyncHandler(async (req, res) => {
    const days = clampDays(req.query.days);
    const data = await cached(`eng:calls:${days}`, 5 * 60_000, async () => {
      const since = new Date(startOfUtcDay().getTime() - (days - 1) * DAY);
      const [facet] = await Call.aggregate([
        { $match: { startedAt: { $gte: since } } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  answered: { $sum: { $cond: [{ $ifNull: ['$answeredAt', false] }, 1, 0] } },
                  talkSec: { $sum: { $ifNull: ['$durationSec', 0] } },
                  withDuration: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$durationSec', 0] }, 0] }, 1, 0] } },
                },
              },
            ],
            byType: [{ $group: { _id: '$callType', n: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
            byEndReason: [{ $group: { _id: { $ifNull: ['$endReason', 'none'] }, n: { $sum: 1 } } }],
            daily: [
              { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } }, count: { $sum: 1 } } },
            ],
            dailyAnswered: [
              { $match: { answeredAt: { $ne: null } } },
              { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } }, count: { $sum: 1 } } },
            ],
          },
        },
      ]).option({ maxTimeMS: MAX_MS });
      const t = facet.totals[0] || { total: 0, answered: 0, talkSec: 0, withDuration: 0 };
      const toObj = (rows) => Object.fromEntries(rows.map((r) => [r._id || 'unknown', r.n]));
      return {
        days,
        total: t.total,
        answered: t.answered,
        answerRate: t.total ? t.answered / t.total : null,
        avgDurationSec: t.withDuration ? Math.round(t.talkSec / t.withDuration) : 0,
        totalTalkMinutes: Math.round(t.talkSec / 60),
        byType: toObj(facet.byType),
        byStatus: toObj(facet.byStatus),
        byEndReason: toObj(facet.byEndReason),
        series: fillDaySeries(facet.daily, days),
        answeredSeries: fillDaySeries(facet.dailyAnswered, days),
      };
    });
    res.json(data);
  }),
);

router.get(
  '/links',
  asyncHandler(async (_req, res) => {
    const data = await cached('eng:links', 10 * 60_000, async () => {
      const [byType, top] = await Promise.all([
        ShortLink.aggregate([{ $group: { _id: '$type', links: { $sum: 1 }, clicks: { $sum: '$clickCount' } } }]),
        ShortLink.find({}).sort({ clickCount: -1 }).limit(20).lean(),
      ]);
      const refs = await loadUserRefs(User, top.map((l) => l.ownerUserId));
      return {
        byType: Object.fromEntries(byType.map((r) => [r._id, { links: r.links, clicks: r.clicks }])),
        top: top.map((l) => ({
          slug: l.slug,
          type: l.type,
          clicks: l.clickCount || 0,
          owner: l.ownerUserId ? refs.get(String(l.ownerUserId)) || null : null,
          createdAt: l.createdAt,
        })),
      };
    });
    res.json(data);
  }),
);

module.exports = router;
