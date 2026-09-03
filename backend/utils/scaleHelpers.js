/**
 * Scale helpers for multi-instance Render (Redis when available).
 */
const { getRedis } = require('./redis');

/**
 * Atomic open-streak update — safe under concurrent pings / multi-instance.
 */
async function atomicOpenStreak(User, userId, today, yesterday) {
  const current = await User.findById(userId).select(
    'openStreakDays lastOpenDate spinCycleDay subscriptionSpinsUsedToday subscriptionSpinsDate subscriptionPlan subscriptionExpiresAt lastSpinDate',
  );
  if (!current) return null;

  if (current.lastOpenDate === today) {
    return {
      openStreakDays: Number(current.openStreakDays) || 0,
      lastOpenDate: today,
      streakContinued: true,
      alreadyCountedToday: true,
      spinCycleDay: Number(current.spinCycleDay) || 0,
      user: current,
    };
  }

  const nextStreak =
    current.lastOpenDate === yesterday
      ? Math.max(1, Number(current.openStreakDays) || 0) + 1
      : 1;

  const updated = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { lastOpenDate: { $ne: today } },
        { lastOpenDate: null },
        { lastOpenDate: { $exists: false } },
      ],
    },
    { $set: { openStreakDays: nextStreak, lastOpenDate: today } },
    { returnDocument: 'after' },
  ).select(
    'openStreakDays lastOpenDate spinCycleDay subscriptionSpinsUsedToday subscriptionSpinsDate subscriptionPlan subscriptionExpiresAt lastSpinDate',
  );

  if (updated) {
    return {
      openStreakDays: Number(updated.openStreakDays) || nextStreak,
      lastOpenDate: today,
      streakContinued: current.lastOpenDate === yesterday,
      alreadyCountedToday: false,
      spinCycleDay: Number(updated.spinCycleDay) || 0,
      user: updated,
    };
  }

  const fresh = await User.findById(userId).select(
    'openStreakDays lastOpenDate spinCycleDay subscriptionSpinsUsedToday subscriptionSpinsDate subscriptionPlan subscriptionExpiresAt lastSpinDate',
  );
  return {
    openStreakDays: Number(fresh?.openStreakDays) || 0,
    lastOpenDate: fresh?.lastOpenDate || today,
    streakContinued: false,
    alreadyCountedToday: fresh?.lastOpenDate === today,
    spinCycleDay: Number(fresh?.spinCycleDay) || 0,
    user: fresh,
  };
}

/**
 * Redis INCR rate limit. Falls back to allowing the request if Redis is down
 * (memory limiters on each route still apply as secondary guard).
 */
function redisRateLimit({ prefix, windowMs, max }) {
  return async function redisRateLimitMiddleware(req, res, next) {
    try {
      const r = await getRedis();
      if (!r) return next();
      const id = req.userId || req.ip || 'anon';
      const key = `rl:${prefix}:${id}`;
      const n = await r.incr(key);
      if (n === 1) await r.pexpire(key, windowMs);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - n)));
      if (n > max) {
        return res.status(429).json({
          error: 'Too many requests. Please slow down.',
          code: 'RATE_LIMITED',
        });
      }
    } catch {
      /* fail open — memory limiter still protects single instance */
    }
    return next();
  };
}

module.exports = {
  atomicOpenStreak,
  redisRateLimit,
};
