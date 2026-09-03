/**
 * Retention helpers — daily open streak (UTC date key).
 * Does not change spin / chat / discovery logic.
 */

const { todayKey } = require('./subscriptions');

/**
 * Record an app open. Idempotent within the same UTC day.
 * Returns updated streak fields.
 */
function applyOpenStreak(user, now = new Date()) {
  const today = todayKey(now);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = todayKey(yesterdayDate);

  const last = user.lastOpenDate || null;
  let openStreakDays = Number(user.openStreakDays) || 0;

  if (last === today) {
    return {
      openStreakDays,
      lastOpenDate: today,
      streakContinued: true,
      alreadyCountedToday: true,
    };
  }

  if (last === yesterday) {
    openStreakDays = Math.max(1, openStreakDays) + 1;
  } else {
    openStreakDays = 1;
  }

  user.openStreakDays = openStreakDays;
  user.lastOpenDate = today;

  return {
    openStreakDays,
    lastOpenDate: today,
    streakContinued: last === yesterday,
    alreadyCountedToday: false,
  };
}

module.exports = {
  applyOpenStreak,
};
