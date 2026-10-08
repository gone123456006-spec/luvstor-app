/**
 * Role → permission map. Routes declare the permission they need; roles are
 * never checked directly outside this file.
 */
const PERMISSIONS = {
  'overview.view': ['owner', 'admin', 'moderator', 'support', 'analyst'],
  'users.view': ['owner', 'admin', 'moderator', 'support'],
  'users.ban': ['owner', 'admin', 'moderator'],
  'users.logout': ['owner', 'admin', 'moderator', 'support'],
  'users.tokens': ['owner', 'admin'],
  'users.verification': ['owner', 'admin', 'moderator'],
  'users.restore': ['owner', 'admin'],
  'moderation.view': ['owner', 'admin', 'moderator'],
  'moderation.act': ['owner', 'admin', 'moderator'],
  'money.view': ['owner', 'admin', 'analyst'],
  'engagement.view': ['owner', 'admin', 'analyst'],
  'notifications.view': ['owner', 'admin'],
  'notifications.send': ['owner', 'admin'],
  'support.view': ['owner', 'admin', 'moderator', 'support'],
  'support.act': ['owner', 'admin', 'moderator', 'support'],
  'system.view': ['owner', 'admin'],
  'audit.view': ['owner', 'admin'],
  'versions.view': ['owner', 'admin', 'analyst', 'support'],
  'versions.manage': ['owner', 'admin'],
  'admins.manage': ['owner'],
};

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  return Array.isArray(allowed) && allowed.includes(role);
}

function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => can(role, p));
}

module.exports = { PERMISSIONS, can, permissionsFor };
