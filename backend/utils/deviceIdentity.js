/**
 * Device identity for single-device login.
 *
 * Clients send:
 *   a:<androidId>  — survives uninstall/reinstall (same signing key)
 *   i:<idfv>       — survives reinstall while vendor apps remain
 *   f:<uuid>       — last-resort fallback (lost on uninstall)
 *   <uuid>         — legacy AsyncStorage-only IDs from older builds
 */

function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim();
}

function isStableHardwareId(deviceId) {
  const id = normalizeDeviceId(deviceId);
  return /^a:[A-Za-z0-9_-]{8,}$/i.test(id) || /^i:[A-Za-z0-9_-]{8,}$/i.test(id);
}

function isLegacyInstallId(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return false;
  if (isStableHardwareId(id)) return false;
  // Explicit fallback prefix, or any older unprefixed UUID / random string
  return true;
}

/**
 * True when another physical device already holds the session.
 * Same hardware id, empty binding, or legacy→hardware upgrade on the same
 * phone after app update/reinstall → false (no transfer prompt).
 */
function isOtherDeviceActive(user, deviceId) {
  const active = normalizeDeviceId(user?.activeDeviceId);
  const next = normalizeDeviceId(deviceId);
  if (!active || !next || active === next) return false;

  // Same phone: server still has install UUID, client now sends Android ID / IDFV
  if (isStableHardwareId(next) && isLegacyInstallId(active)) {
    return false;
  }

  return true;
}

/** True when binding is just rewriting UUID → hardware on the same phone. */
function isLegacyHardwareUpgrade(previousDeviceId, nextDeviceId) {
  const prev = normalizeDeviceId(previousDeviceId);
  const next = normalizeDeviceId(nextDeviceId);
  return Boolean(prev) && Boolean(next) && prev !== next
    && isLegacyInstallId(prev)
    && isStableHardwareId(next);
}

module.exports = {
  normalizeDeviceId,
  isStableHardwareId,
  isLegacyInstallId,
  isOtherDeviceActive,
  isLegacyHardwareUpgrade,
};
