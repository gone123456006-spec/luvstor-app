/**
 * Cross-context flag: CallProvider is nested under SocketProvider, so the
 * socket layer cannot use useCall(). While a call is active we must NOT
 * disconnect the socket on AppState background (WhatsApp keeps signaling up).
 */

let callSessionActive = false;

export function setCallSessionActive(active: boolean) {
  callSessionActive = !!active;
}

export function isCallSessionActive() {
  return callSessionActive;
}
