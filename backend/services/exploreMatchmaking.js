/**
 * Explore random voice/video matchmaking — fully independent of friends/chat.
 * - Separate queues for video and voice (never cross-match)
 * - Anonymous peer cards (no real name / photo / publicId on either side)
 * - No friend links, chat messages, or notification-center rows
 */

const User = require('../models/User');
const { getBlockState } = require('../utils/blockState');
const { canonicalShowMe } = require('../utils/showMe');
const calls = require('./calls');

/** @type {Map<string, object>} */
const videoQueue = new Map();
/** @type {Map<string, object>} */
const voiceQueue = new Map();

function normalizeType(callType) {
  return callType === 'video' ? 'video' : 'voice';
}

function queueFor(callType) {
  return normalizeType(callType) === 'video' ? videoQueue : voiceQueue;
}

function normalizePrefs(prefs = {}) {
  const showMe = canonicalShowMe(prefs.showMe) || 'All';
  return {
    showMe,
    verifiedOnly: !!prefs.verifiedOnly,
  };
}

/** Does A's showMe accept B's gender? */
function wantsGender(showMe, peerGender) {
  const want = canonicalShowMe(showMe) || 'All';
  if (want === 'All') return true;
  const peer = canonicalShowMe(peerGender);
  if (!peer) return true; // unknown gender — don't block forever
  return want === peer;
}

function prefsCompatible(a, b) {
  if (!wantsGender(a.showMe, b.gender)) return false;
  if (!wantsGender(b.showMe, a.gender)) return false;
  if (a.verifiedOnly && !b.photoVerified) return false;
  if (b.verifiedOnly && !a.photoVerified) return false;
  return true;
}

/**
 * Leave explore queue(s).
 * @param {string} userId
 * @param {'voice'|'video'|undefined} callType - if set, leave only that queue
 */
function leaveQueue(userId, callType) {
  const uid = String(userId);
  if (callType === 'video') {
    videoQueue.delete(uid);
    return;
  }
  if (callType === 'voice') {
    voiceQueue.delete(uid);
    return;
  }
  videoQueue.delete(uid);
  voiceQueue.delete(uid);
}

/**
 * Join one explore mode queue.
 * @param {string} userId
 * @param {'voice'|'video'} callType
 * @param {{ gender?: string, showMe?: string, verifiedOnly?: boolean, photoVerified?: boolean }} [prefs]
 */
function joinQueue(userId, callType, prefs = {}) {
  const uid = String(userId);
  const type = normalizeType(callType);
  leaveQueue(uid);
  const normalized = normalizePrefs(prefs);
  const entry = {
    userId: uid,
    callType: type,
    joinedAt: Date.now(),
    gender: canonicalShowMe(prefs.gender) || '',
    showMe: normalized.showMe,
    verifiedOnly: normalized.verifiedOnly,
    photoVerified: !!prefs.photoVerified,
  };
  queueFor(type).set(uid, entry);
  return entry;
}

function isInQueue(userId, callType) {
  const uid = String(userId);
  if (callType === 'video') return videoQueue.has(uid);
  if (callType === 'voice') return voiceQueue.has(uid);
  return videoQueue.has(uid) || voiceQueue.has(uid);
}

function queueSize(callType) {
  return queueFor(callType).size;
}

async function pickMatch(callType) {
  const type = normalizeType(callType);
  const q = queueFor(type);
  const ids = [...q.keys()];
  if (ids.length < 2) return null;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const entryA = q.get(a);
      const entryB = q.get(b);
      if (!entryA || !entryB) continue;

      if (!prefsCompatible(entryA, entryB)) continue;

      const block = await getBlockState(a, b);
      if (block.blocked) continue;

      q.delete(a);
      q.delete(b);
      return { callerId: a, calleeId: b, callType: type };
    }
  }
  return null;
}

/** Anonymous card only — gender kept for avatar tint, nothing identifiable */
function explorePeerCard(snapshot) {
  return {
    id: 'explore',
    name: 'Anonymous',
    photo: '',
    gender: snapshot?.gender || '',
    publicId: '',
    photoVerified: false,
  };
}

async function startExploreCall(io, notifyUser, { callerId, calleeId, callType }) {
  const type = normalizeType(callType);
  leaveQueue(callerId);
  leaveQueue(calleeId);

  const roomId = `explore_${type}_${Date.now()}_${callerId.slice(-4)}_${calleeId.slice(-4)}`;
  const result = await calls.startOutgoing({
    callerId,
    calleeId,
    callType: type,
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

  return { ok: true, callId: session.callId, callType: type };
}

async function tryMatch(io, notifyUser, callType) {
  const match = await pickMatch(callType);
  if (!match) return null;
  return startExploreCall(io, notifyUser, match);
}

/**
 * Load gender / verification / saved explore prefs for a joining user.
 */
async function loadJoinProfile(userId) {
  const u = await User.findById(userId)
    .select('gender explorePrefs photoVerification showMe')
    .lean();
  if (!u) return null;
  return {
    gender: canonicalShowMe(u.gender) || '',
    photoVerified: u.photoVerification?.status === 'approved',
    showMe:
      canonicalShowMe(u.explorePrefs?.showMe) ||
      canonicalShowMe(u.showMe) ||
      'All',
    verifiedOnly: !!u.explorePrefs?.verifiedOnly,
  };
}

module.exports = {
  joinQueue,
  leaveQueue,
  isInQueue,
  queueSize,
  tryMatch,
  startExploreCall,
  loadJoinProfile,
  normalizePrefs,
  prefsCompatible,
};
