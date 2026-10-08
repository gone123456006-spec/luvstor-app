const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.ADMIN_JWT_SECRET ||= 'x'.repeat(48);
process.env.MAIN_API_URL ||= 'http://127.0.0.1:1';
process.env.MAIN_ADMIN_API_KEY ||= 'test-key';

const {
  normalizeVersion,
  compareVersions,
  versionStatus,
  highestVersion,
  versionsForStatus,
} = require('../lib/appVersions');
const { can } = require('../lib/permissions');

test('versions are normalised and junk is rejected', () => {
  assert.equal(normalizeVersion('1.0.5'), '1.0.5');
  assert.equal(normalizeVersion(' v1.2 '), '1.2');
  assert.equal(normalizeVersion('1.0.5 (7)'), null);
  assert.equal(normalizeVersion(''), null);
  assert.equal(normalizeVersion(null), null);
  assert.equal(normalizeVersion('$where'), null);
});

test('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.equal(highestVersion(['1.0.5', '1.0.10', 'junk', null, '1.0.9']), '1.0.10');
});

test('users are bucketed as latest, outdated or unknown', () => {
  assert.equal(versionStatus('1.0.5', '1.0.5'), 'latest');
  assert.equal(versionStatus('1.0.6', '1.0.5'), 'latest');
  assert.equal(versionStatus('1.0.4', '1.0.5'), 'outdated');
  assert.equal(versionStatus(null, '1.0.5'), 'unknown');
  assert.equal(versionStatus('1.0.4', null), 'latest');
  assert.deepEqual(versionsForStatus(['1.0.3', '1.0.5', null, '1.0.4'], 'outdated', '1.0.5'), ['1.0.3', '1.0.4']);
});

test('only owners and admins can change the latest version', () => {
  assert.ok(can('owner', 'versions.manage'));
  assert.ok(can('admin', 'versions.manage'));
  assert.ok(!can('analyst', 'versions.manage'));
  assert.ok(can('analyst', 'versions.view'));
  assert.ok(!can('moderator', 'versions.view'));
});
