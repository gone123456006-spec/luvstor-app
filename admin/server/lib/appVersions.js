/**
 * Which app version each user runs. Source of truth is `users.appVersion`
 * (recorded by the app backend on every signed-in request); users who haven't
 * opened a build that reports it fall back to the version their push
 * registration sent (`devicetokens.appVersion`).
 */
const { AdminSetting } = require('../models/admin');

const VERSION_RE = /^\d{1,4}(?:\.\d{1,4}){0,3}$/;
const LATEST_KEY = 'app.latestVersion';

function normalizeVersion(v) {
  const s = String(v ?? '').trim().replace(/^v/i, '');
  return VERSION_RE.test(s) ? s : null;
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 'latest' (incl. newer test builds) | 'outdated' | 'unknown' */
function versionStatus(version, latest) {
  const v = normalizeVersion(version);
  if (!v) return 'unknown';
  if (!latest) return 'latest';
  return compareVersions(v, latest) >= 0 ? 'latest' : 'outdated';
}

function highestVersion(versions) {
  return versions
    .map(normalizeVersion)
    .filter(Boolean)
    .reduce((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), null);
}

async function getLatestSetting() {
  const doc = await AdminSetting.findOne({ key: LATEST_KEY }).lean();
  return doc ? { version: normalizeVersion(doc.value), updatedAt: doc.updatedAt, updatedByEmail: doc.updatedByEmail } : null;
}

async function setLatestSetting(version, admin) {
  if (!version) {
    await AdminSetting.deleteOne({ key: LATEST_KEY });
    return;
  }
  await AdminSetting.updateOne(
    { key: LATEST_KEY },
    { $set: { value: version, updatedBy: admin?._id || null, updatedByEmail: admin?.email || '' } },
    { upsert: true },
  );
}

/** Adds `ev` (effective version), `ep` (platform) and `src` ('app' | 'push' | 'none') */
function effectiveVersionStages() {
  return [
    {
      $lookup: {
        from: 'devicetokens',
        let: { uid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$uid'] }, appVersion: { $nin: ['', null] } } },
          { $sort: { lastUsedAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, appVersion: 1, platform: 1 } },
        ],
        as: '_dev',
      },
    },
    { $addFields: { _dev: { $first: '$_dev' } } },
    {
      $addFields: {
        ev: { $ifNull: ['$appVersion', '$_dev.appVersion'] },
        ep: { $ifNull: ['$appPlatform', '$_dev.platform'] },
        src: {
          $cond: [
            { $ifNull: ['$appVersion', false] },
            'app',
            { $cond: [{ $ifNull: ['$_dev.appVersion', false] }, 'push', 'none'] },
          ],
        },
      },
    },
    { $project: { _dev: 0 } },
  ];
}

/** Latest version for badges on user lists: manual setting, else the highest seen */
function latestVersionHint() {
  const { cached } = require('./cache');
  return cached('versions:latestHint', 60_000, async () => {
    const setting = await getLatestSetting();
    if (setting?.version) return setting.version;
    const { User, DeviceToken } = require('../models/app');
    const [fromUsers, fromDevices] = await Promise.all([
      User.distinct('appVersion').maxTimeMS(15_000),
      DeviceToken.distinct('appVersion').maxTimeMS(15_000),
    ]);
    return highestVersion([...fromUsers, ...fromDevices]);
  });
}

/**
 * Per-user app info for a page of users (each needs appVersion/appPlatform/
 * appBuild/appVersionSeenAt selected). Falls back to push registrations.
 */
async function appInfoForUsers(users) {
  const { DeviceToken } = require('../models/app');
  const missing = users.filter((u) => !normalizeVersion(u.appVersion)).map((u) => u._id);
  const [latest, devices] = await Promise.all([
    latestVersionHint().catch(() => null),
    missing.length
      ? DeviceToken.find({ userId: { $in: missing }, appVersion: { $nin: ['', null] } })
          .sort({ lastUsedAt: -1 })
          .select('userId appVersion platform')
          .lean()
      : [],
  ]);
  const deviceByUser = new Map();
  for (const d of devices) {
    if (!deviceByUser.has(String(d.userId))) deviceByUser.set(String(d.userId), d);
  }
  const out = new Map();
  for (const u of users) {
    const own = normalizeVersion(u.appVersion);
    const dev = own ? null : deviceByUser.get(String(u._id));
    const version = own || dev?.appVersion || null;
    out.set(String(u._id), {
      version,
      build: own ? u.appBuild || null : null,
      platform: (own ? u.appPlatform : dev?.platform) || null,
      source: own ? 'app' : dev ? 'push' : 'none',
      seenAt: own ? u.appVersionSeenAt || null : null,
      status: versionStatus(version, latest),
      latest,
    });
  }
  return out;
}

/** Versions from `rows` ([{version}]) that fall into `status` */
function versionsForStatus(versions, status, latest) {
  return versions.filter((v) => normalizeVersion(v) && versionStatus(v, latest) === status);
}

module.exports = {
  LATEST_KEY,
  normalizeVersion,
  compareVersions,
  versionStatus,
  highestVersion,
  getLatestSetting,
  setLatestSetting,
  effectiveVersionStages,
  versionsForStatus,
  latestVersionHint,
  appInfoForUsers,
};
