/**
 * WhatsApp-style call events in the chat thread
 * (Missed voice call / Voice call · 1:23 / etc.)
 */
const Message = require('../models/Message');
const { notifyUser } = require('./realtime');

function formatDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build the label both users see in chat (WhatsApp-style).
 */
function callChatLabel({ callType = 'voice', status, endReason, durationSec = 0 }) {
  const kind = callType === 'video' ? 'Video call' : 'Voice call';
  const missedKind = callType === 'video' ? 'Missed video call' : 'Missed voice call';

  if (status === 'busy' || endReason === 'busy') {
    return callType === 'video' ? 'Busy video call' : 'Busy voice call';
  }
  if (
    status === 'missed' ||
    status === 'unavailable' ||
    endReason === 'timeout' ||
    endReason === 'offline' ||
    endReason === 'no_answer'
  ) {
    return missedKind;
  }
  if (status === 'rejected' || endReason === 'decline') {
    return callType === 'video' ? 'Declined video call' : 'Declined voice call';
  }
  // Local mic/camera denial — don't leave a confusing "Cancelled" line
  if (endReason === 'permission' || endReason === 'media') {
    return null;
  }
  if (status === 'cancelled' || endReason === 'cancel') {
    return callType === 'video' ? 'Cancelled video call' : 'Cancelled voice call';
  }
  if (status === 'ended' || status === 'connected') {
    if (durationSec > 0) return `${kind} · ${formatDuration(durationSec)}`;
    return kind;
  }
  return missedKind;
}

/**
 * Persist + fan-out a call system message to both participants.
 * senderId = caller (so "You" previews work on caller side).
 */
async function postCallChatEvent(io, {
  callerId,
  calleeId,
  roomId,
  callId,
  callType = 'voice',
  status = 'missed',
  endReason = 'timeout',
  durationSec = 0,
}) {
  const cId = String(callerId || '');
  const rId = String(calleeId || '');
  if (!cId || !rId || cId === rId) return null;

  const room =
    roomId ||
    [cId, rId].sort().join('_');
  const text = callChatLabel({ callType, status, endReason, durationSec });
  if (!text) return null;

  try {
    // Dedupe: one chat line per callId
    if (callId) {
      const existing = await Message.findOne({
        roomId: room,
        type: 'call',
        'callMeta.callId': String(callId),
      })
        .select('_id')
        .lean();
      if (existing) return existing;
    }

    const message = await Message.create({
      roomId: room,
      senderId: cId,
      receiverId: rId,
      text,
      type: 'call',
      delivered: true,
      deliveredAt: new Date(),
      read: true,
      readAt: new Date(),
      callMeta: {
        callId: callId ? String(callId) : '',
        callType: callType === 'video' ? 'video' : 'voice',
        status: String(status || 'missed'),
        endReason: String(endReason || ''),
        durationSec: Math.max(0, Math.floor(Number(durationSec) || 0)),
      },
    });

    const payload = {
      _id: message._id,
      roomId: room,
      senderId: cId,
      receiverId: rId,
      text: message.text,
      type: 'call',
      mediaUrl: null,
      delivered: true,
      read: true,
      undelivered: false,
      createdAt: message.createdAt,
      callMeta: message.callMeta,
      isCallEvent: true,
    };

    if (io) {
      notifyUser(io, cId, 'chat:message', payload);
      notifyUser(io, rId, 'chat:message', payload);
      // Keep chat list preview in sync
      notifyUser(io, cId, 'chat:notification', {
        from: rId,
        roomId: room,
        text,
        type: 'call',
        messageId: String(message._id),
        silent: true,
      });
      notifyUser(io, rId, 'chat:notification', {
        from: cId,
        roomId: room,
        text,
        type: 'call',
        messageId: String(message._id),
        silent: true,
      });
    }

    return message;
  } catch (err) {
    console.error('[callChat] post failed:', err.message);
    return null;
  }
}

module.exports = {
  postCallChatEvent,
  callChatLabel,
  formatDuration,
};
