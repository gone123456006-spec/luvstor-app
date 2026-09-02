/**
 * Explore random voice/video matchmaking — independent from friends/chat.
 * Shows real name, ID, and profile photo (WhatsApp-style) but no friend links.
 */

const { getBlockState } = require('../utils/blockState');
const calls = require('./calls');

/** @type {Map<string, { userId: string, callType: 'voice'|'video', joinedAt: number }>} */
const videoQueue = new Map();
/** @type {Map<string, { userId: string, callType: 'voice'|'video', joinedAt: number }>} */
const voiceQueue = new Map();

function queueFor(callType) {
  return callType === 'video' ? videoQueue : voiceQueue;
}

function leaveQueue(userId) {
  videoQueue.delete(String(userId));
  voiceQueue.delete(String(userId));
}

function joinQueue(userId, callType) {
  const uid = String(userId);
  leaveQueue(uid);
  const type = callType === 'video' ? 'video' : 'voice';
  const entry = { userId: uid, callType: type, joinedAt: Date.now() };
  queueFor(type).set(uid, entry);
  return entry;
}

function isInQueue(userId) {
  const uid = String(userId);
  return videoQueue.has(uid) || voiceQueue.has(uid);
}

async function pickMatch(callType) {
  const q = queueFor(callType);
  const ids = [...q.keys()];
  if (ids.length < 2) return null;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const block = await getBlockState(a, b);
      if (block.blocked) continue;
      q.delete(a);
      q.delete(b);
      return { callerId: a, calleeId: b, callType };
    }
  }
  return null;
}

function explorePeerCard(snapshot) {
  return {
    id: 'explore',
    name: snapshot?.name || 'User',
    photo: snapshot?.photo || '',
    gender: snapshot?.gender || '',
    publicId: snapshot?.publicId || '',
  };
}

async function startExploreCall(io, notifyUser, { callerId, calleeId, callType }) {
  const roomId = `explore_${Date.now()}_${callerId.slice(-4)}_${calleeId.slice(-4)}`;
  const result = await calls.startOutgoing({
    callerId,
    calleeId,
    callType,
    roomId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code };
  }

  const session = result.session;
  const iceServers = result.iceServers || calls.getIceServers();
  const ringTimeoutMs = result.ringTimeoutMs || calls.RING_TIMEOUT_MS;

  const [callerProfile, calleeProfile] = await Promise.all([
    calls.actorSnapshot(callerId),
    calls.actorSnapshot(calleeId),
  ]);

  const callerCard = explorePeerCard(callerProfile);
  const calleeCard = explorePeerCard(calleeProfile);

  notifyUser(io, callerId, 'call:ringing', {
    callId: session.callId,
    callType: session.callType,
    receiverId: calleeId,
    callee: calleeCard,
    iceServers,
    ringTimeoutMs,
    explore: true,
  });

  notifyUser(io, calleeId, 'call:incoming', {
    callId: session.callId,
    callType: session.callType,
    from: callerId,
    caller: callerCard,
    iceServers,
    explore: true,
    autoAccept: true,
  });

  notifyUser(io, callerId, 'explore:matched', {
    callType: session.callType,
    role: 'caller',
    callId: session.callId,
    peer: calleeCard,
  });
  notifyUser(io, calleeId, 'explore:matched', {
    callType: session.callType,
    role: 'callee',
    callId: session.callId,
    peer: callerCard,
  });

  return { ok: true, callId: session.callId };
}

async function tryMatch(io, notifyUser, callType) {
  const match = await pickMatch(callType);
  if (!match) return null;
  return startExploreCall(io, notifyUser, match);
}

module.exports = {
  joinQueue,
  leaveQueue,
  isInQueue,
  tryMatch,
  startExploreCall,
};
