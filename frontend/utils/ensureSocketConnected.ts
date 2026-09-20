import type { Socket } from 'socket.io-client';

/**
 * Ensure Socket.IO is connected before call / explore actions.
 * After backgrounding we deliberately disconnect; resume reconnect is async,
 * so tapping Call immediately used to fail with a false "Not connected".
 */
export async function ensureSocketConnected(
  socket: Socket | null | undefined,
  timeoutMs = 12_000,
): Promise<boolean> {
  if (!socket) return false;
  if (socket.connected) return true;

  try {
    socket.connect();
  } catch {
    /* ignore */
  }

  if (socket.connected) return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      resolve(ok);
    };

    const onConnect = () => finish(true);
    const timer = setTimeout(() => finish(!!socket.connected), timeoutMs);

    socket.once('connect', onConnect);
    if (socket.connected) finish(true);
  });
}
