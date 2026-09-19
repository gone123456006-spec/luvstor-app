/**
 * Call-related FCM / notification-center copy.
 * Used for incoming, missed, busy, and offline wake-ups.
 */
const { createNotification } = require('../services/notifications');

function callLabel(callType) {
  return callType === 'video' ? 'video call' : 'voice call';
}

/**
 * High-priority wake-up when someone is being called (online or offline).
 */
async function pushIncomingCall(io, {
  calleeId,
  caller,
  callerId,
  callId,
  callType = 'voice',
  roomId,
  calleeOnline = true,
}) {
  const name = (caller && caller.name) || 'Someone';
  const kind = callLabel(callType);
  const body = calleeOnline
    ? `Incoming ${kind}`
    : `Incoming ${kind} — open Luvstor to answer`;

  return createNotification(io, {
    userId: calleeId,
    type: 'call',
    title: name,
    body,
    actorId: callerId || caller?.id || caller?._id,
    actorName: name,
    actorPhoto: (caller && caller.photo) || '',
    priority: 'high',
    groupKey: `call:${callId}`,
    deepLink: `/messages/${callerId}`,
    data: {
      screen: 'call',
      userId: String(callerId),
      roomId: roomId || '',
      callId: String(callId),
      callType,
      action: 'incoming',
      calleeOnline: Boolean(calleeOnline),
    },
  });
}

/**
 * After ring timeout / no answer (callee may have been offline).
 */
async function pushMissedCall(io, {
  calleeId,
  callerId,
  callerName,
  callId,
  callType = 'voice',
  roomId,
  reason = 'timeout',
}) {
  const kind = callLabel(callType);
  let body = `Missed ${kind}`;
  if (reason === 'busy') {
    body = `Missed ${kind} while you were on another call`;
  } else if (reason === 'offline' || reason === 'timeout') {
    body = `Missed ${kind} while you were away`;
  }

  return createNotification(io, {
    userId: calleeId,
    type: 'call',
    title: callerName || 'Missed call',
    body,
    actorId: callerId,
    actorName: callerName || '',
    priority: 'high',
    groupKey: `call:missed:${roomId || callId}`,
    deepLink: `/messages/${callerId}`,
    data: {
      screen: 'messages',
      userId: String(callerId),
      callId: String(callId),
      callType,
      missed: true,
      reason,
    },
  });
}

module.exports = {
  pushIncomingCall,
  pushMissedCall,
  callLabel,
};
