/**
 * Production call session manager — signaling state, busy locks, timeouts, ICE config.
 * Media is peer-to-peer WebRTC; this service only manages sessions + history.
 */

const crypto = require('crypto');
const Call = require('../models/Call');
const User = require('../models/User');
const { notifyUser } = require('../utils/realtime');
const { isReady: redisReady, getRedis } = require('../utils/redis');

const RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS || 45_000);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.CALL_HEARTBEAT_TIMEOUT_MS || 25_000);
const CLEANUP_INTERVAL_MS = 8_000;

/** @type {Map<string, object>} callId → session */
const sessions = new Map();
/** @type {Map<string, string>} userId → callId (one active call per user) */
const userCall = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const ringTimers = new Map();
/** @type {Map<string, number>} callId → last heartbeat epoch ms (either party) */
const heartbeats = new Map();

let ioRef = null;
let cleanupTimer = null;

function setIo(io) {
  ioRef = io;
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      void sweepStaleSessions();
    }, CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
  }
}

function generateCallId() {
  return `c_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function getIceServers() {
  const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ urls: url }));

  const turnUrls = (process.env.TURN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const turnUser = process.env.TURN_USERNAME || '';
  const turnPass = process.env.TURN_CREDENTIAL || '';

  const turn = turnUrls.map((url) => ({
    urls: url,
    username: turnUser || undefined,
    credential: turnPass || undefined,
  }));

  return [...stun, ...turn];
}

function publicSession(session) {
  if (!session) return null;
  return {
    callId: session.callId,
    callerId: session.callerId,
    calleeId: session.calleeId,
    callType: session.callType,
    status: session.status,
    roomId: session.roomId,
    startedAt: session.startedAt,
    answeredAt: session.answeredAt || null,
  };
}

async function redisSetActive(userId, callId) {
  if (!redisReady()) return;
  try {
    const r = await getRedis();
    if (!r) return;
    await r.set(`call:user:${userId}`, callId, 'EX', 120);
    await r.set(`call:session:${callId}`, '1', 'EX', 120);
  } catch {
    /* ignore */
  }
}

async function redisClearActive(userId, callId) {
  if (!redisReady()) return;
  try {
    const r = await getRedis();
    if (!r) return;
    const cur = await r.get(`call:user:${userId}`);
    if (cur === callId) await r.del(`call:user:${userId}`);
    await r.del(`call:session:${callId}`);
  } catch {
    /* ignore */
  }
}

function getActiveCallForUser(userId) {
  const id = userCall.get(String(userId));
  if (!id) return null;
  return sessions.get(id) || null;
}

async function actorSnapshot(userId) {
  const u = await User.findById(userId).select('name photo gender publicId').lean();
  return {
    id: String(userId),
    name: u?.name || 'User',
    photo: u?.photo || '',
    gender: u?.gender || '',
    publicId: u?.publicId || '',
  };
}

function clearRingTimer(callId) {
  const t = ringTimers.get(callId);
  if (t) {
    clearTimeout(t);
    ringTimers.delete(callId);
  }
}

async function persistEnd(session, status, endReason, endedBy) {
  const endedAt = new Date();
  let durationSec = 0;
  if (session.answeredAt) {
    durationSec = Math.max(0, Math.floor((endedAt - new Date(session.answeredAt)) / 1000));
  }
  try {
    await Call.findOneAndUpdate(
      { callId: session.callId },
      {
        status,
        endReason,
        endedBy: endedBy || null,
        endedAt,
        durationSec,
        answeredAt: session.answeredAt || null,
      }
    );
  } catch (err) {
    console.error('[calls] persistEnd:', err.message);
  }
  return { endedAt, durationSec };
}

async function destroySession(callId, { status, endReason, endedBy, notify = true } = {}) {
  const session = sessions.get(callId);
  if (!session) return null;

  clearRingTimer(callId);
  sessions.delete(callId);
  heartbeats.delete(callId);

  if (userCall.get(session.callerId) === callId) userCall.delete(session.callerId);
  if (userCall.get(session.calleeId) === callId) userCall.delete(session.calleeId);
  await redisClearActive(session.callerId, callId);
  await redisClearActive(session.calleeId, callId);

  const finalStatus = status || 'ended';
  const { endedAt, durationSec } = await persistEnd(
    session,
    finalStatus,
    endReason || 'hangup',
    endedBy
  );

  const payload = {
    callId,
    status: finalStatus,
    endReason: endReason || 'hangup',
    endedBy: endedBy ? String(endedBy) : null,
    durationSec,
    endedAt,
    callType: session.callType,
    callerId: session.callerId,
    calleeId: session.calleeId,
  };

  if (notify && ioRef) {
    notifyUser(ioRef, session.callerId, 'call:ended', payload);
    notifyUser(ioRef, session.calleeId, 'call:ended', payload);
  }

  console.log(
    `[calls] end ${callId} status=${finalStatus} reason=${endReason || 'hangup'} dur=${durationSec}s`
  );
  return payload;
}

async function startOutgoing({
  callerId,
  calleeId,
  callType = 'voice',
  callId: preferredId,
  roomId,
}) {
  const cId = String(callerId);
  const rId = String(calleeId);

  if (cId === rId) {
    return { ok: false, code: 'INVALID', error: 'Cannot call yourself' };
  }

  if (getActiveCallForUser(cId)) {
    return { ok: false, code: 'BUSY_SELF', error: 'You are already in a call' };
  }

  const calleeBusy = getActiveCallForUser(rId);
  if (calleeBusy) {
    // Persist a busy attempt for history on callee side
    const busyId = preferredId || generateCallId();
    try {
      await Call.create({
        callId: busyId,
        callerId: cId,
        calleeId: rId,
        callType,
        status: 'busy',
        endReason: 'busy',
        endedAt: new Date(),
        roomId: roomId || '',
      });
    } catch {
      /* ignore duplicate */
    }
    return { ok: false, code: 'BUSY', error: 'User is busy on another call', callId: busyId };
  }

  const callId = preferredId || generateCallId();
  const startedAt = new Date();
  const session = {
    callId,
    callerId: cId,
    calleeId: rId,
    callType: callType === 'video' ? 'video' : 'voice',
    status: 'ringing',
    roomId: roomId || [cId, rId].sort().join('_'),
    startedAt,
    answeredAt: null,
    offerFrom: null,
  };

  sessions.set(callId, session);
  userCall.set(cId, callId);
  userCall.set(rId, callId);
  heartbeats.set(callId, Date.now());
  await redisSetActive(cId, callId);
  await redisSetActive(rId, callId);

  try {
    await Call.create({
      callId,
      callerId: cId,
      calleeId: rId,
      callType: session.callType,
      status: 'ringing',
      roomId: session.roomId,
      startedAt,
    });
  } catch (err) {
    console.error('[calls] create:', err.message);
  }

  const timer = setTimeout(() => {
    void (async () => {
      const s = sessions.get(callId);
      if (!s || s.status !== 'ringing') return;
      const callerId = s.callerId;
      const calleeId = s.calleeId;
      const type = s.callType;
      const room = s.roomId;
      await destroySession(callId, {
        status: 'missed',
        endReason: 'timeout',
        endedBy: null,
      });
      try {
        const { createNotification } = require('./notifications');
        if (ioRef) {
          await createNotification(ioRef, {
            userId: calleeId,
            type: 'call',
            title: 'Missed call',
            body: type === 'video' ? 'Missed video call' : 'Missed voice call',
            actorId: callerId,
            priority: 'high',
            groupKey: `call:missed:${room}`,
            deepLink: `/messages/${callerId}`,
            data: {
              screen: 'messages',
              userId: String(callerId),
              callId,
              callType: type,
              missed: true,
            },
          });
        }
      } catch (err) {
        console.error('[calls] missed notify:', err.message);
      }
    })();
  }, RING_TIMEOUT_MS);
  ringTimers.set(callId, timer);

  const caller = await actorSnapshot(cId);
  const callee = await actorSnapshot(rId);

  return {
    ok: true,
    session: publicSession(session),
    caller,
    callee,
    iceServers: getIceServers(),
    ringTimeoutMs: RING_TIMEOUT_MS,
  };
}

async function acceptCall(callId, userId) {
  const session = sessions.get(callId);
  if (!session) return { ok: false, code: 'NOT_FOUND', error: 'Call not found' };
  if (String(userId) !== session.calleeId) {
    return { ok: false, code: 'FORBIDDEN', error: 'Only the callee can accept' };
  }
  if (session.status !== 'ringing') {
    return { ok: false, code: 'INVALID_STATE', error: `Cannot accept in state ${session.status}` };
  }

  clearRingTimer(callId);
  session.status = 'connecting';
  session.answeredAt = new Date();
  heartbeats.set(callId, Date.now());

  try {
    await Call.findOneAndUpdate(
      { callId },
      { status: 'connecting', answeredAt: session.answeredAt }
    );
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    session: publicSession(session),
    iceServers: getIceServers(),
  };
}

async function markConnected(callId, userId) {
  const session = sessions.get(callId);
  if (!session) return { ok: false, code: 'NOT_FOUND' };
  if (![session.callerId, session.calleeId].includes(String(userId))) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  if (session.status === 'connected') {
    return { ok: true, session: publicSession(session) };
  }
  session.status = 'connected';
  heartbeats.set(callId, Date.now());
  try {
    await Call.findOneAndUpdate({ callId }, { status: 'connected' });
  } catch {
    /* ignore */
  }
  return { ok: true, session: publicSession(session) };
}

function touchHeartbeat(callId, userId) {
  const session = sessions.get(callId);
  if (!session) return false;
  if (![session.callerId, session.calleeId].includes(String(userId))) return false;
  heartbeats.set(callId, Date.now());
  return true;
}

function getSession(callId) {
  return sessions.get(callId) || null;
}

function isParticipant(session, userId) {
  if (!session) return false;
  const u = String(userId);
  return session.callerId === u || session.calleeId === u;
}

function otherParty(session, userId) {
  if (!session) return null;
  const u = String(userId);
  return session.callerId === u ? session.calleeId : session.callerId;
}

async function sweepStaleSessions() {
  const now = Date.now();
  for (const [callId, session] of sessions.entries()) {
    const last = heartbeats.get(callId) || new Date(session.startedAt).getTime();
    // Only enforce heartbeat after connect / connecting
    if (session.status === 'ringing') continue;
    if (now - last > HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[calls] heartbeat timeout ${callId}`);
      await destroySession(callId, {
        status: 'ended',
        endReason: 'disconnect',
        endedBy: null,
      });
    }
  }
}

async function handleUserDisconnect(userId) {
  const session = getActiveCallForUser(userId);
  if (!session) return;
  // Grace: keep session briefly; heartbeat sweep will end if peer gone
  // If still ringing and caller disconnects → cancel; callee disconnect → miss
  if (session.status === 'ringing') {
    if (String(userId) === session.callerId) {
      await destroySession(session.callId, {
        status: 'cancelled',
        endReason: 'disconnect',
        endedBy: userId,
      });
    }
  }
}

async function listHistory(userId, { limit = 40, before } = {}) {
  const uid = String(userId);
  const q = {
    $or: [{ callerId: uid }, { calleeId: uid }],
  };
  if (before) q.createdAt = { $lt: new Date(before) };

  const rows = await Call.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  const otherIds = [
    ...new Set(
      rows.map((r) =>
        String(r.callerId) === uid ? String(r.calleeId) : String(r.callerId)
      )
    ),
  ];
  const users = await User.find({ _id: { $in: otherIds } })
    .select('name photo gender publicId')
    .lean();
  const map = new Map(users.map((u) => [String(u._id), u]));

  return rows.map((r) => {
    const otherId = String(r.callerId) === uid ? String(r.calleeId) : String(r.callerId);
    const other = map.get(otherId);
    return {
      callId: r.callId,
      callType: r.callType,
      status: r.status,
      endReason: r.endReason,
      direction: String(r.callerId) === uid ? 'outgoing' : 'incoming',
      durationSec: r.durationSec || 0,
      startedAt: r.startedAt,
      answeredAt: r.answeredAt,
      endedAt: r.endedAt,
      other: {
        id: otherId,
        name: other?.name || 'User',
        photo: other?.photo || '',
        gender: other?.gender || '',
        publicId: other?.publicId || '',
      },
    };
  });
}

module.exports = {
  setIo,
  generateCallId,
  getIceServers,
  getActiveCallForUser,
  getSession,
  isParticipant,
  otherParty,
  actorSnapshot,
  startOutgoing,
  acceptCall,
  markConnected,
  touchHeartbeat,
  destroySession,
  handleUserDisconnect,
  listHistory,
  publicSession,
  RING_TIMEOUT_MS,
};
