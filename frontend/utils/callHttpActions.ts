/**
 * HTTP helpers for Answer / Decline when the socket is not yet connected
 * (notification shade / cold start).
 */
import { apiRequest } from './api';
import { getAuthToken } from './auth';

export async function declineCallHttp(callId: string): Promise<boolean> {
  const id = String(callId || '').trim();
  if (!id) return false;
  try {
    const token = await getAuthToken();
    if (!token) return false;
    await apiRequest(`/api/calls/${encodeURIComponent(id)}/decline`, token, {
      method: 'POST',
      body: '{}',
    });
    return true;
  } catch (err: any) {
    console.warn('[Call] HTTP decline failed:', err?.message);
    return false;
  }
}

export async function acceptCallHttp(callId: string): Promise<{
  ok: boolean;
  iceServers?: any[];
  session?: any;
}> {
  const id = String(callId || '').trim();
  if (!id) return { ok: false };
  try {
    const token = await getAuthToken();
    if (!token) return { ok: false };
    const res = await apiRequest(
      `/api/calls/${encodeURIComponent(id)}/accept`,
      token,
      {
        method: 'POST',
        body: '{}',
      },
    );
    return {
      ok: !!res?.ok,
      iceServers: res?.iceServers,
      session: res?.session,
    };
  } catch (err: any) {
    console.warn('[Call] HTTP accept failed:', err?.message);
    return { ok: false };
  }
}
