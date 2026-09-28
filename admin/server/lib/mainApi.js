const { config } = require('../config');
const { HttpError } = require('./http');

/**
 * Calls the main backend's existing admin endpoints (x-admin-key) so actions
 * with side effects (token grants, notifications, sockets) run the app's own code.
 */
async function mainApi(path, { method = 'GET', body, timeoutMs = 20_000, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers['x-admin-key'] = config.mainAdminKey;

  let res;
  try {
    res = await fetch(`${config.mainApiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new HttpError(502, `Main API unreachable: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`, 'MAIN_API_DOWN');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const message = data?.error || `Main API error (${res.status})`;
    throw new HttpError(res.status >= 500 ? 502 : res.status, message, data?.code || 'MAIN_API_ERROR');
  }
  return data;
}

/** Probe without throwing — for the System page. */
async function probe(path, { auth = false, timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${config.mainApiUrl}${path}`, {
      headers: auth ? { 'x-admin-key': config.mainAdminKey } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, ms: Date.now() - started, data };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: err.message };
  }
}

module.exports = { mainApi, probe };
