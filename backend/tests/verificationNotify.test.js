/**
 * Admin approve / reject of photo verification notifies the user.
 * Uses its own scratch database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_verification_notify_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const ADMIN_KEY = 'verification-notify-admin-key';

let available = false;
let server;
let base;
let User;
let Notification;

let seq = 0;
async function makePendingUser() {
  seq += 1;
  return User.create({
    email: `vn-${seq}-${Date.now()}@test.local`,
    name: `Verify ${seq}`,
    isVerified: true,
    publicId: `VRFN${String(1000 + seq)}`,
    photo: '/uploads/x/main.jpg',
    photoVerification: { status: 'pending', selfieUrl: '/uploads/x/selfie.jpg', submittedAt: new Date() },
  });
}

async function decide(user, decision, reviewNote) {
  const res = await fetch(`${base}/api/verification/admin/${user._id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify({ decision, reviewNote }),
  });
  assert.equal(res.status, 200);
}

test.before(async () => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[verification notify] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) throw new Error('Refusing to use a non-scratch database');
  User = require('../models/User');
  Notification = require('../models/Notification');
  await mongoose.connection.dropDatabase();
  await Notification.init();

  const app = express();
  app.use(express.json());
  app.use('/api/verification', require('../routes/verification'));
  app.set('io', null);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available) {
    if (mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('admin reject sends a notification with the reason', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makePendingUser();
  await decide(user, 'reject', 'Face not clearly visible');
  const rows = await Notification.find({ userId: user._id, 'data.code': 'PHOTO_REJECTED' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Photo verification failed');
  assert.equal(rows[0].body, 'Face not clearly visible');
});

test('admin approve sends a photo verified notification, also on re-approval', async (t) => {
  if (!available) return t.skip('MongoDB unavailable');
  const user = await makePendingUser();
  await decide(user, 'approve');
  let rows = await Notification.find({ userId: user._id, 'data.code': 'PHOTO_VERIFIED' }).lean();
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /verified/);

  // Tokens were already granted once; a later re-approval must still notify
  await User.updateOne({ _id: user._id }, { $set: { 'photoVerification.status': 'rejected' } });
  await decide(user, 'approve');
  rows = await Notification.find({ userId: user._id, 'data.code': 'PHOTO_VERIFIED' }).lean();
  assert.equal(rows.length, 2);
});
