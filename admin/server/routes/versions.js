const express = require('express');
const { User } = require('../models/app');
const { asyncHandler, HttpError, pageParams, oneOf, daysAgo } = require('../lib/http');
const { audit } = require('../lib/audit');
const { cached, invalidate } = require('../lib/cache');
const { LIST_FIELDS, listUser } = require('../lib/users');
const {
  normalizeVersion,
  compareVersions,
  versionStatus,
  highestVersion,
  getLatestSetting,
  setLatestSetting,
  effectiveVersionStages,
  versionsForStatus,
} = require('../lib/appVersions');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
const MAX_MS = 30_000;
const ACTIVE_WINDOWS = ['all', '1', '7', '30', '90'];

function baseMatch(activeDays) {
  const match = { deletionScheduledAt: null, isDeactivated: { $ne: true } };
  if (activeDays !== 'all') match.lastSeen = { $gte: daysAgo(Number(activeDays)) };
  return match;
}

/** [{ version, platform, source, count }] for the audience */
function loadBreakdown(activeDays) {
  return cached(`versions:breakdown:${activeDays}`, 60_000, async () => {
    const rows = await User.aggregate([
      { $match: baseMatch(activeDays) },
      { $project: { _id: 1, appVersion: 1, appPlatform: 1 } },
      ...effectiveVersionStages(),
      { $group: { _id: { v: '$ev', p: '$ep', s: '$src' }, count: { $sum: 1 } } },
    ])
      .option({ maxTimeMS: MAX_MS })
      .exec();
    return rows.map((r) => ({
      version: r._id.v || null,
      platform: r._id.p || null,
      source: r._id.s,
      count: r.count,
    }));
  });
}

async function resolveLatest(breakdown) {
  const setting = await getLatestSetting();
  const detected = highestVersion(breakdown.map((r) => r.version));
  return {
    latest: setting?.version || detected,
    latestSource: setting?.version ? 'manual' : detected ? 'detected' : 'none',
    detectedLatest: detected,
    setting,
  };
}

router.get(
  '/summary',
  requirePermission('versions.view'),
  asyncHandler(async (req, res) => {
    const activeDays = oneOf(req.query.activeDays, ACTIVE_WINDOWS, '30');
    const breakdown = await loadBreakdown(activeDays);
    const latestInfo = await resolveLatest(breakdown);
    const { latest } = latestInfo;

    const counts = { total: 0, latest: 0, outdated: 0, unknown: 0 };
    const byVersion = new Map();
    const byPlatform = {};
    let fromPush = 0;
    for (const row of breakdown) {
      const status = versionStatus(row.version, latest);
      counts.total += row.count;
      counts[status] += row.count;
      if (row.source === 'push') fromPush += row.count;
      const platform = row.platform || 'unknown';
      byPlatform[platform] ||= { total: 0, latest: 0, outdated: 0, unknown: 0 };
      byPlatform[platform].total += row.count;
      byPlatform[platform][status] += row.count;

      const key = normalizeVersion(row.version) || 'unknown';
      const entry = byVersion.get(key) || { version: key === 'unknown' ? null : key, status, count: 0, ios: 0, android: 0, other: 0 };
      entry.count += row.count;
      if (row.platform === 'ios') entry.ios += row.count;
      else if (row.platform === 'android') entry.android += row.count;
      else entry.other += row.count;
      byVersion.set(key, entry);
    }

    const versions = [...byVersion.values()].sort((a, b) => {
      if (!a.version) return 1;
      if (!b.version) return -1;
      return compareVersions(b.version, a.version);
    });
    const pct = (n) => (counts.total ? Math.round((n / counts.total) * 1000) / 10 : 0);

    res.json({
      activeDays,
      ...latestInfo,
      counts,
      percent: { latest: pct(counts.latest), outdated: pct(counts.outdated), unknown: pct(counts.unknown) },
      fromPush,
      byPlatform,
      versions,
    });
  }),
);

router.get(
  '/users',
  requirePermission('versions.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const activeDays = oneOf(req.query.activeDays, ACTIVE_WINDOWS, '30');
    const status = oneOf(req.query.status, ['all', 'latest', 'outdated', 'unknown'], 'all');
    const version = normalizeVersion(req.query.version);
    const platform = oneOf(req.query.platform, ['ios', 'android'], '');

    const breakdown = await loadBreakdown(activeDays);
    const { latest } = await resolveLatest(breakdown);

    const versionMatch = {};
    if (version) {
      versionMatch.ev = version;
    } else if (status === 'unknown') {
      const known = versionsForStatus([...new Set(breakdown.map((r) => r.version))], 'latest', latest).concat(
        versionsForStatus([...new Set(breakdown.map((r) => r.version))], 'outdated', latest),
      );
      versionMatch.ev = { $nin: known };
    } else if (status !== 'all') {
      versionMatch.ev = { $in: versionsForStatus([...new Set(breakdown.map((r) => r.version))], status, latest) };
    }
    if (platform) versionMatch.ep = platform;

    const projection = Object.fromEntries(
      `${LIST_FIELDS} appVersion appBuild appPlatform appVersionSeenAt`.split(/\s+/).filter(Boolean).map((f) => [f, 1]),
    );
    const [result] = await User.aggregate([
      { $match: baseMatch(activeDays) },
      { $sort: { lastSeen: -1 } },
      { $project: projection },
      ...effectiveVersionStages(),
      ...(Object.keys(versionMatch).length ? [{ $match: versionMatch }] : []),
      { $facet: { rows: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ])
      .option({ maxTimeMS: MAX_MS, allowDiskUse: true })
      .exec();

    const rows = result?.rows || [];
    res.json({
      latest,
      page,
      limit,
      total: result?.total?.[0]?.n || 0,
      users: rows.map((u) => ({
        ...listUser(u),
        app: {
          version: u.ev || null,
          build: u.src === 'app' ? u.appBuild || null : null,
          platform: u.ep || null,
          source: u.src,
          seenAt: u.appVersionSeenAt || null,
          status: versionStatus(u.ev, latest),
        },
      })),
    });
  }),
);

router.put(
  '/latest',
  requirePermission('versions.manage'),
  asyncHandler(async (req, res) => {
    const raw = req.body?.version;
    const version = raw === null || raw === '' ? null : normalizeVersion(raw);
    if (raw !== null && raw !== '' && !version) throw new HttpError(400, 'Use a version like 1.0.6');
    const before = await getLatestSetting();
    await setLatestSetting(version, req.admin);
    invalidate('versions:');
    await audit(req, 'versions.set_latest', {
      details: { from: before?.version || null, to: version },
    });
    res.json({ ok: true, version });
  }),
);

module.exports = router;
