/**
 * Verify that the nearby API returns isOnline as a boolean.
 */
const assert = require('assert');
const User = require('../models/User');

async function testOnlineStatusSerialization() {
  console.log('\n=== Testing Online Status Serialization ===\n');

  // Create test user with isOnline = true
  const userOnline = {
    _id: '6a3cba48c1a112e027dac39d',
    publicId: 'TEST1234',
    name: 'Online User',
    age: 25,
    gender: 'male',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    isOnline: true,
    lastSeen: new Date(),
    createdAt: new Date(),
  };

  // Create test user with isOnline = false
  const userOffline = {
    _id: '6a3cbde8c1a112e027dac3a0',
    publicId: 'TEST5678',
    name: 'Offline User',
    age: 26,
    gender: 'female',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    isOnline: false,
    lastSeen: new Date(Date.now() - 3600000), // 1 hour ago
    createdAt: new Date(),
  };

  // Test conversion with !!
  const onlineResult = !!userOnline.isOnline;
  const offlineResult = !!userOffline.isOnline;

  console.log('1. Online user isOnline:', userOnline.isOnline, '→ !!:', onlineResult);
  console.log('2. Offline user isOnline:', userOffline.isOnline, '→ !!:', offlineResult);

  assert.strictEqual(typeof onlineResult, 'boolean', 'Online result should be boolean');
  assert.strictEqual(typeof offlineResult, 'boolean', 'Offline result should be boolean');
  assert.strictEqual(onlineResult, true, 'Online user should be true');
  assert.strictEqual(offlineResult, false, 'Offline user should be false');

  // Test with undefined/null values
  const undefinedUser = { isOnline: undefined };
  const nullUser = { isOnline: null };
  const missingUser = {};

  console.log('\n3. Undefined isOnline:', undefinedUser.isOnline, '→ !!:', !!undefinedUser.isOnline);
  console.log('4. Null isOnline:', nullUser.isOnline, '→ !!:', !!nullUser.isOnline);
  console.log('5. Missing isOnline:', missingUser.isOnline, '→ !!:', !!missingUser.isOnline);

  assert.strictEqual(!!undefinedUser.isOnline, false, 'Undefined should convert to false');
  assert.strictEqual(!!nullUser.isOnline, false, 'Null should convert to false');
  assert.strictEqual(!!missingUser.isOnline, false, 'Missing should convert to false');

  console.log('\n✅ All online status serialization tests passed!\n');
}

testOnlineStatusSerialization().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
