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
const HEARTBEAT_TIMEOUT_MS = Number(process.env.CALL_HEARTBEAT_TIMEOUT_MS || 60_000);
const CLEANUP_INTERVAL_MS = 8_000;

/** @type {Map<string, object>} callId → session */
const sessions = new Map();
/** @type {Map<string, string>} userId → callId (one active call per user) */
const userCall = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const ringTimers = new Map();
/** @type {Map<string, { caller: number, callee: number }>} per-party heartbeats */
const heartbeats = new Map();
/** callId → expiry — cancel arrived before invite finished creating the session */
const pendingCancels = new Map();

let ioRef = null;
let cleanupTimer = null;
let turnWarned = false;

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

/**
 * Public STUN — geographic distance is never a call rule (Nearby 100 km is
 * display/filter only). STUN helps easy NAT; TURN is required across ISPs.
 */
const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

/**
 * Last-resort public TURN so distant / cellular / CGNAT calls still connect
 * when TURN_URLS is unset. Prefer your own Metered / Twilio / coturn in prod.
 */
const PUBLIC_TURN_FALLBACK = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function iceListHasTurn(list) {
  if (!Array.isArray(list) || !list.length) return false;
  return list.some((s) => {
    const urls = [].concat(s?.urls || []);
    return urls.some((u) => /^turns?:/i.test(String(u || '')));
  });
}

/** Fill missing UDP / TCP / TLS transports per host (carriers block odd ports). */
function ensureTurnTransports(urls) {
  const seen = new Set(urls);
  const byHost = new Map();
  for (const url of urls) {
    const m = String(url).match(/^turns?:([^:/?#]+)/i);
    if (!m) continue;
    const host = m[1].toLowerCase();
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(url);
  }
  const out = urls.slice();
  for (const [host, list] of byHost) {
    const hasUdp = list.some((u) => !/\?transport=tcp/i.test(u) && !/^turns:/i.test(u));
    const hasTcp = list.some((u) => /\?transport=tcp/i.test(u) || /:443/.test(u));
    const hasTls = list.some((u) => /^turns:/i.test(u));
    const add = [];
    if (!hasUdp) add.push(`turn:${host}:3478`);
    if (!hasTcp) add.push(`turn:${host}:3478?transport=tcp`);
    if (!hasTls) add.push(`turns:${host}:443?transport=tcp`);
    for (const extra of add) {
      if (!seen.has(extra)) {
        seen.add(extra);
        out.push(extra);
      }
    }
  }
  return out;
}

function getIceServers() {
  const stun = (process.env.STUN_URLS || DEFAULT_STUN_URLS.join(','))
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

  const validTurnUrls = [];
  const invalidTurnUrls = [];
  const seen = new Set();
  for (const url of turnUrls) {
    // Must be turn: / turns: URIs — not API keys or bare tokens
    if (!/^turns?:/i.test(url)) {
      invalidTurnUrls.push(url);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    validTurnUrls.push(url);
  }

  const expanded = ensureTurnTransports(validTurnUrls);

  if (invalidTurnUrls.length && !turnWarned) {
    turnWarned = true;
    console.error(
      '[calls] TURN_URLS is invalid — entries must look like ' +
        '"turn:host:3478" or "turns:host:443". ' +
        'Got non-URI value(s) (often a Metered API key pasted by mistake). ' +
        'Cellular / different-network calls will fail until fixed.',
    );
  }

  const turn = expanded.map((url) => ({
    urls: url,
    username: turnUser || undefined,
    credential: turnPass || undefined,
  }));

  // Distance does not matter — without TURN, different ISPs / CGNAT never connect.
  if (turn.length === 0) {
    if (!turnWarned) {
      turnWarned = true;
      console.warn(
        '[calls] No TURN_URLS — using public relay fallback so calls work at any range. ' +
          'Set TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL for production quality.',
      );
    }
    return [...stun, ...PUBLIC_TURN_FALLBACK];
  }

  return [...stun, ...turn];
}

function isValidClientCallId(id) {
  return typeof id === 'string' && /^c_[a-z0-9]+_[a-f0-9]{8,}$/i.test(id);
}

function markPendingCancel(callId) {
  if (!callId) return;
  pendingCancels.set(String(callId), Date.now() + 60_000);
}

function consumePendingCancel(callId) {
  const id = String(callId || '');
  if (!id || !pendingCancels.has(id)) return false;
  pendingCancels.delete(id);
  return true;
}

function initPartyHeartbeats(callId) {
  const now = Date.now();
  heartbeats.set(callId, { caller: now, callee: now });
}

function touchPartyHeartbeat(callId, role) {
  const cur = heartbeats.get(callId) || { caller: 0, callee: 0 };
  cur[role] = Date.now();
  heartbeats.set(callId, cur);
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

async function redisGetActive(userId) {
  if (!redisReady()) return null;
  try {
    const r = await getRedis();
    if (!r) return null;
    return (await r.get(`call:user:${String(userId)}`)) || null;
  } catch {
    return null;
  }
}

/** Local Map first, then Redis (multi-instance busy locks). */
async function isUserInCall(userId) {
  if (getActiveCallForUser(userId)) return true;
  const remote = await redisGetActive(userId);
  return !!remote;
}

async function redisRefreshCallTtl(callId, callerId, calleeId) {
  await redisSetActive(callerId, callId);
  await redisSetActive(calleeId, callId);
}

/** Ringing call where this user is the callee (for deliver-on-reconnect). */
function getRingingIncomingForUser(userId) {
  const callId = userCall.get(String(userId));
  if (!callId) return null;
  const session = sessions.get(callId);
  if (!session || session.status !== 'ringing') return null;
  if (String(session.calleeId) !== String(userId)) return null;
  return session;
}

function storePendingOffer(callId, sdp, fromUserId) {
  const session = sessions.get(callId);
  if (!session || !sdp) return;
  session.pendingOffer = { sdp, from: String(fromUserId) };
}

function storePendingAnswer(callId, sdp, fromUserId) {
  const session = sessions.get(callId);
  if (!session || !sdp) return;
  session.pendingAnswer = { sdp, from: String(fromUserId) };
}

function storePendingIce(callId, candidate, fromUserId) {
  const session = sessions.get(callId);
  if (!session || !candidate) return;
  if (!Array.isArray(session.pendingIce)) session.pendingIce = [];
  // Cap buffer — TURN/TCP/TLS gathering produces more candidates than host/srflx
  if (session.pendingIce.length < 128) {
    session.pendingIce.push({ candidate, from: String(fromUserId) });
  }
}

function takePendingSignaling(callId) {
  const session = sessions.get(callId);
  if (!session) return { offer: null, answer: null, ice: [] };
  const offer = session.pendingOffer;
  const answer = session.pendingAnswer;
  const ice = Array.isArray(session.pendingIce) ? session.pendingIce.slice() : [];
  session.pendingOffer = null;
  session.pendingAnswer = null;
  session.pendingIce = [];
  return { offer, answer, ice };
}

function peekPendingSignaling(callId) {
  const session = sessions.get(callId);
  if (!session) return { offer: null, answer: null, ice: [] };
  return {
    offer: session.pendingOffer || null,
    answer: session.pendingAnswer || null,
    ice: Array.isArray(session.pendingIce) ? session.pendingIce.slice() : [],
  };
}

function getActiveCallForUser(userId) {
  const id = userCall.get(String(userId));
  if (!id) return null;
  return sessions.get(id) || null;
}

async function actorSnapshot(userId) {
  const u = await User.findById(userId)
    .select('name photo gender publicId photoVerification')
    .lean();
  return {
    id: String(userId),
    name: u?.name || 'User',
    photo: u?.photo || '',
    gender: u?.gender || '',
    publicId: u?.publicId || '',
    photoVerified: u?.photoVerification?.status === 'approved',
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
  pendingCancels.delete(callId);

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

  // Clear ringing FCM tray on the callee (cancel / decline / accept / timeout)
  // so a killed phone does not keep a stale "Incoming call".
  if (
    ['cancelled', 'rejected', 'ended', 'missed', 'busy'].includes(finalStatus)
  ) {
    try {
      const { pushClearIncomingCall } = require('../utils/callPush');
      void pushClearIncomingCall(session.calleeId, callId);
      // Also clear on caller's other devices if any
      void pushClearIncomingCall(session.callerId, callId);
    } catch (err) {
      console.warn('[calls] clear incoming push:', err.message);
    }
  }

  // WhatsApp-style auto message in the chat thread
  if (!session.explore) {
    try {
      const { postCallChatEvent } = require('../utils/callChatMessage');
      await postCallChatEvent(ioRef, {
        callerId: session.callerId,
        calleeId: session.calleeId,
        roomId: session.roomId,
        callId,
        callType: session.callType,
        status: finalStatus,
        endReason: endReason || 'hangup',
        durationSec,
      });
    } catch (err) {
      console.warn('[calls] call chat message:', err.message);
    }
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

  if (await isUserInCall(cId)) {
    return { ok: false, code: 'BUSY_SELF', error: 'You are already in a call' };
  }

  if (await isUserInCall(rId)) {
    // Persist a busy attempt for history on callee side
    const busyId =
      preferredId && isValidClientCallId(preferredId)
        ? preferredId
        : generateCallId();
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

  const callId =
    preferredId && isValidClientCallId(preferredId)
      ? preferredId
      : generateCallId();

  // Caller hung up before invite finished — honour cancel, don't ring
  if (consumePendingCancel(callId)) {
    return {
      ok: false,
      code: 'CANCELLED',
      error: 'Call was cancelled',
      callId,
    };
  }

  const startedAt = new Date();
  const session = {
    callId,
    callerId: cId,
    calleeId: rId,
    callType: callType === 'video' ? 'video' : 'voice',
    status: 'ringing',
    roomId: roomId || [cId, rId].sort().join('_'),
    explore: String(roomId || '').startsWith('explore_'),
    startedAt,
    answeredAt: null,
    offerFrom: null,
    /** Buffered SDP / ICE so late-joining (offline→online) callees still connect */
    pendingOffer: null,
    pendingAnswer: null,
    pendingIce: [],
  };

  sessions.set(callId, session);
  userCall.set(cId, callId);
  userCall.set(rId, callId);
  initPartyHeartbeats(callId);
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
        const { pushMissedCall } = require('../utils/callPush');
        if (ioRef) {
          const caller = await actorSnapshot(callerId);
          await pushMissedCall(ioRef, {
            calleeId,
            callerId,
            callerName: caller?.name,
            callId,
            callType: type,
            roomId: room,
            reason: 'timeout',
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
  initPartyHeartbeats(callId);

  // Drop ringing trays on all of the callee's devices
  try {
    const { pushClearIncomingCall } = require('../utils/callPush');
    void pushClearIncomingCall(session.calleeId, callId);
  } catch {
    /* ignore */
  }

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
  const role = String(userId) === session.callerId ? 'caller' : 'callee';
  touchPartyHeartbeat(callId, role);
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
  const u = String(userId);
  if (u !== session.callerId && u !== session.calleeId) return false;
  const role = u === session.callerId ? 'caller' : 'callee';
  touchPartyHeartbeat(callId, role);
  // Keep Redis busy-lock alive for the full call duration
  void redisRefreshCallTtl(callId, session.callerId, session.calleeId);
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
  for (const [id, exp] of pendingCancels.entries()) {
    if (exp < now) pendingCancels.delete(id);
  }
  for (const [callId, session] of sessions.entries()) {
    // Only enforce heartbeat after connect / connecting
    if (session.status === 'ringing') continue;
    const hb = heartbeats.get(callId);
    const started = new Date(session.startedAt).getTime();
    const callerLast = hb?.caller || started;
    const calleeLast = hb?.callee || started;
    // End if EITHER party goes silent (app killed / network drop)
    if (
      now - callerLast > HEARTBEAT_TIMEOUT_MS ||
      now - calleeLast > HEARTBEAT_TIMEOUT_MS
    ) {
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
  getRingingIncomingForUser,
  storePendingOffer,
  storePendingAnswer,
  storePendingIce,
  takePendingSignaling,
  peekPendingSignaling,
  iceListHasTurn,
  getSession,
  isParticipant,
  otherParty,
  actorSnapshot,
  startOutgoing,
  acceptCall,
  markConnected,
  touchHeartbeat,
  markPendingCancel,
  destroySession,
  handleUserDisconnect,
  listHistory,
  publicSession,
  RING_TIMEOUT_MS,
};
