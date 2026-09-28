/**
 * Broadcast audiences. Filters are built at send time (dates are relative) and
 * passed to the app's /api/notifications/broadcast, which adds
 * `isDeactivated: { $ne: true }` itself and casts ISO date strings.
 */
const DAY = 86_400_000;

const SEGMENTS = {
  all: { label: 'All users', build: () => ({}) },
  active7d: {
    label: 'Active in the last 7 days',
    build: (now) => ({ lastSeen: { $gte: new Date(now - 7 * DAY).toISOString() } }),
  },
  inactive7d: {
    label: 'Inactive 7–30 days',
    build: (now) => ({
      lastSeen: { $lt: new Date(now - 7 * DAY).toISOString(), $gte: new Date(now - 30 * DAY).toISOString() },
    }),
  },
  inactive30d: {
    label: 'Inactive 30–90 days',
    build: (now) => ({
      lastSeen: { $lt: new Date(now - 30 * DAY).toISOString(), $gte: new Date(now - 90 * DAY).toISOString() },
    }),
  },
  men: { label: 'Men', build: () => ({ gender: 'Man' }) },
  women: { label: 'Women', build: () => ({ gender: 'Woman' }) },
  subscribers: {
    label: 'Paid subscribers',
    build: (now) => ({
      subscriptionPlan: { $nin: [null, 'free'] },
      subscriptionExpiresAt: { $gt: new Date(now).toISOString() },
    }),
  },
  free: {
    label: 'Free users',
    build: (now) => ({
      $or: [
        { subscriptionPlan: { $in: [null, 'free'] } },
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { $lte: new Date(now).toISOString() } },
      ],
    }),
  },
  photoVerified: { label: 'Photo-verified users', build: () => ({ 'photoVerification.status': 'approved' }) },
  incompleteProfile: { label: 'Signed up but never finished profile', build: () => ({ profileCompleted: { $ne: true } }) },
};

function segmentFilter(key, now = Date.now()) {
  const seg = SEGMENTS[key];
  return seg ? seg.build(now) : null;
}

/** Same filter with real Date objects, for counting locally. */
function reviveDates(value) {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v)]));
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value);
  return value;
}

function audienceQuery(key, now = Date.now()) {
  const filter = segmentFilter(key, now);
  if (!filter) return null;
  return { isDeactivated: { $ne: true }, ...reviveDates(filter) };
}

function segmentList() {
  return Object.entries(SEGMENTS).map(([key, s]) => ({ key, label: s.label }));
}

module.exports = { SEGMENTS, segmentFilter, audienceQuery, segmentList };
