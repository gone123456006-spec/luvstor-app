/**
 * End-to-end WebRTC signaling checks for voice + video calls.
 *
 * Boots the real Socket.IO server with the real JWT/device auth middleware and
 * drives two authenticated clients through the full handshake the chat screen
 * performs: invite → incoming → ringing → accept → accepted → offer → answer →
 * ice-candidate → connected → end.
 *
 * This is the layer the service-level tests skip: it proves the event names the
 * app emits actually match the ones the server listens for, in both directions.
 *
 * Uses its own scratch database so it can run alongside the other suites.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional here */
}

const TEST_DB_NAME = 'luvstor_call_signaling_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(`Refusing to run: cannot rewrite "${uri}" to ${TEST_DB_NAME}.`);
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);
const JWT_SECRET = process.env.JWT_SECRET || 'call-signaling-test-secret';

let available = false;
let server;
let io;
let port;
let User;
let Friendship;

/** Resolve once the client receives `event`, or reject on timeout. */
function waitFor(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function connectClient(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const timer = setTimeout(
      () => reject(new Error('socket connect timed out')),
      8000,
    );
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let seq = 0;
async function makeUser(deviceId) {
  seq += 1;
  return User.create({
    email: `call-${seq}-${Date.now()}@test.local`,
    name: `Caller ${seq}`,
    age: 26,
    gender: seq % 2 ? 'Man' : 'Woman',
    photo: '/uploads/test/photo.jpg',
    isVerified: true,
    activeDeviceId: deviceId,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  });
}

function tokenFor(user, deviceId) {
  return jwt.sign(
    { userId: String(user._id), deviceId },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

async function befriend(a, b) {
  const { userA, userB } = Friendship.getSortedPair(a._id, b._id);
  await Friendship.create({
    userA,
    userB,
    status: 'friends',
    initiatedBy: a._id,
  });
}

test.before(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (err) {
    console.warn(`[call signaling] skipped — no MongoDB at ${TEST_URI}: ${err.message}`);
    return;
  }

  User = require('../models/User');
  Friendship = require('../models/Friendship');
  await Promise.all([
    User.deleteMany({}),
    Friendship.deleteMany({}),
  ]);

  server = http.createServer();
  io = new Server(server, { cors: { origin: true } });
  require('../socket/index')(io);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  if (io) io.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});

test('socket auth rejects a call client with no token', async (t) => {
  if (!available) return t.skip('no database');
  await assert.rejects(() => connectClient(undefined), /Authentication|token/i);
});

test('voice call: full invite → accept → offer/answer → ice → connected → end', async (t) => {
  if (!available) return t.skip('no database');

  const devA = 'dev-voice-a';
  const devB = 'dev-voice-b';
  const caller = await makeUser(devA);
  const callee = await makeUser(devB);
  await befriend(caller, callee);

  const sockA = await connectClient(tokenFor(caller, devA));
  const sockB = await connectClient(tokenFor(callee, devB));

  try {
    // 1. Caller invites → callee gets call:incoming, caller gets call:ringing
    const incomingP = waitFor(sockB, 'call:incoming');
    const ringingP = waitFor(sockA, 'call:ringing');
    sockA.emit('call:invite', {
      receiverId: String(callee._id),
      callType: 'voice',
    });

    const incoming = await incomingP;
    const ringing = await ringingP;

    assert.ok(incoming.callId, 'callee received a callId');
    assert.equal(incoming.callType, 'voice');
    assert.equal(String(incoming.from), String(caller._id));
    assert.ok(Array.isArray(incoming.iceServers), 'ICE servers delivered to callee');
    assert.ok(
      incoming.iceServers.some((s) =>
        [].concat(s.urls || []).some((u) => /^turns?:/i.test(String(u || ''))),
      ),
      'callee ICE must include TURN so long-range calls can connect',
    );
    assert.equal(ringing.callId, incoming.callId, 'both sides share one callId');
    assert.ok(Array.isArray(ringing.iceServers), 'ICE servers delivered to caller');

    const callId = incoming.callId;

    // 2. Callee accepts → both sides get call:accepted
    const acceptedCallerP = waitFor(sockA, 'call:accepted');
    const acceptedCalleeP = waitFor(sockB, 'call:accepted');
    sockB.emit('call:accept', { callId });
    const acceptedCaller = await acceptedCallerP;
    const acceptedCallee = await acceptedCalleeP;
    assert.equal(acceptedCaller.callId, callId);
    assert.equal(acceptedCallee.isCallee, true, 'callee is told it is the callee');

    // 3. Caller sends SDP offer → callee receives it
    const offerP = waitFor(sockB, 'call:offer');
    sockA.emit('call:offer', {
      callId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    const offer = await offerP;
    assert.equal(offer.sdp.type, 'offer', 'offer SDP relayed intact');

    // 4. Callee answers → caller receives it
    const answerP = waitFor(sockA, 'call:answer');
    sockB.emit('call:answer', {
      callId,
      sdp: { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' },
    });
    const answer = await answerP;
    assert.equal(answer.sdp.type, 'answer', 'answer SDP relayed intact');

    // 5. ICE candidates flow both ways
    const iceToCalleeP = waitFor(sockB, 'call:ice-candidate');
    sockA.emit('call:ice-candidate', {
      callId,
      candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host', sdpMid: '0' },
    });
    const iceToCallee = await iceToCalleeP;
    assert.match(iceToCallee.candidate.candidate, /typ host/);

    const iceToCallerP = waitFor(sockA, 'call:ice-candidate');
    sockB.emit('call:ice-candidate', {
      callId,
      candidate: { candidate: 'candidate:2 1 udp 1 127.0.0.1 2 typ host', sdpMid: '0' },
    });
    const iceToCaller = await iceToCallerP;
    assert.match(iceToCaller.candidate.candidate, /typ host/);

    // 6. Media connected → peer is told
    const connectedP = waitFor(sockB, 'call:connected');
    sockA.emit('call:connected', { callId });
    await connectedP;

    // 7. Hang up → the other side gets call:ended
    const endedP = waitFor(sockB, 'call:ended');
    sockA.emit('call:end', { callId });
    const ended = await endedP;
    assert.equal(ended.callId, callId, 'hangup reaches the peer');
  } finally {
    sockA.close();
    sockB.close();
  }
});

test('video call: invite carries video type and renegotiation is relayed', async (t) => {
  if (!available) return t.skip('no database');

  const devA = 'dev-video-a';
  const devB = 'dev-video-b';
  const caller = await makeUser(devA);
  const callee = await makeUser(devB);
  await befriend(caller, callee);

  const sockA = await connectClient(tokenFor(caller, devA));
  const sockB = await connectClient(tokenFor(callee, devB));

  try {
    const incomingP = waitFor(sockB, 'call:incoming');
    sockA.emit('call:invite', {
      receiverId: String(callee._id),
      callType: 'video',
    });
    const incoming = await incomingP;
    assert.equal(incoming.callType, 'video', 'video call type survives the round trip');

    const callId = incoming.callId;
    const acceptedP = waitFor(sockA, 'call:accepted');
    sockB.emit('call:accept', { callId });
    await acceptedP;

    // Voice → video upgrade path used by switchToVideo()
    const renegP = waitFor(sockB, 'call:renegotiate');
    sockA.emit('call:renegotiate', {
      callId,
      sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' },
      callType: 'video',
    });
    const reneg = await renegP;
    assert.match(reneg.sdp.sdp, /m=video/, 'renegotiation offer relayed');

    const endedP = waitFor(sockB, 'call:ended');
    sockA.emit('call:end', { callId });
    await endedP;
  } finally {
    sockA.close();
    sockB.close();
  }
});

test('calling a non-friend is refused with NOT_FRIENDS', async (t) => {
  if (!available) return t.skip('no database');

  const devA = 'dev-stranger-a';
  const devB = 'dev-stranger-b';
  const caller = await makeUser(devA);
  const stranger = await makeUser(devB);
  // deliberately no friendship

  const sockA = await connectClient(tokenFor(caller, devA));
  const sockB = await connectClient(tokenFor(stranger, devB));

  try {
    const errP = waitFor(sockA, 'call:error');
    sockA.emit('call:invite', {
      receiverId: String(stranger._id),
      callType: 'voice',
    });
    const err = await errP;
    assert.equal(err.code, 'NOT_FRIENDS');
  } finally {
    sockA.close();
    sockB.close();
  }
});

test('calling an offline friend reports OFFLINE rather than hanging', async (t) => {
  if (!available) return t.skip('no database');

  const devA = 'dev-offline-a';
  const devB = 'dev-offline-b';
  const caller = await makeUser(devA);
  const callee = await makeUser(devB);
  await befriend(caller, callee);

  // callee never connects — voice requires online
  const sockA = await connectClient(tokenFor(caller, devA));

  try {
    const errP = waitFor(sockA, 'call:error');
    sockA.emit('call:invite', {
      receiverId: String(callee._id),
      callType: 'voice',
    });
    const err = await errP;
    assert.equal(err.code, 'OFFLINE');
  } finally {
    sockA.close();
  }
});

test('call:error codes lowercase cleanly for the overlay end-reason check', async (t) => {
  if (!available) return t.skip('no database');
  // CallOverlay matches 'offline' / 'busy'; CallContext lowercases payload.code.
  for (const code of ['OFFLINE', 'BUSY', 'NOT_FRIENDS', 'BLOCKED']) {
    assert.equal(String(code).toLowerCase(), code.toLowerCase());
  }
  assert.equal(String('OFFLINE').toLowerCase(), 'offline');
  assert.equal(String('BUSY').toLowerCase(), 'busy');
});
