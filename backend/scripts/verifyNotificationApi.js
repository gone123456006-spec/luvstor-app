/**
 * Smoke test for the notification API surface.
 *
 * Exercises validation and auth on a running local server. The admin key is
 * read from .env, never passed on the command line.
 *
 *   node scripts/verifyNotificationApi.js [baseUrl]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

async function call(name, path, { method = 'GET', body, admin = false, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['x-admin-key'] = ADMIN_KEY;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  console.log(`${String(res.status).padEnd(4)} ${name} → ${text.slice(0, 140)}`);
  return res.status;
}

(async () => {
  if (!ADMIN_KEY) {
    console.warn('⚠️  ADMIN_API_KEY is not set — admin checks will return 503\n');
  }

  console.log(`Testing ${BASE}\n--- auth ---`);
  await call('GET /notifications (no auth)', '/api/notifications');
  await call('GET /devices (no auth)', '/api/devices');
  await call('POST /send (no admin key)', '/api/notifications/send', {
    method: 'POST',
    body: {},
  });

  console.log('\n--- validation (admin) ---');
  await call('invalid type', '/api/notifications/send', {
    method: 'POST',
    admin: true,
    body: { type: 'nope', title: 'x' },
  });
  await call('missing title', '/api/notifications/send', {
    method: 'POST',
    admin: true,
    body: { type: 'promo' },
  });
  await call('no recipients', '/api/notifications/send', {
    method: 'POST',
    admin: true,
    body: { type: 'promo', title: 'Hello' },
  });
  await call('malformed id', '/api/notifications/send', {
    method: 'POST',
    admin: true,
    body: { type: 'promo', title: 'Hello', userIds: ['not-an-id'] },
  });
  await call('malformed JSON', '/api/notifications/send', {
    method: 'POST',
    admin: true,
    raw: '{not json}',
  });

  console.log('\n--- observability (admin) ---');
  await call('health', '/api/notifications/admin/health', { admin: true });
  await call('logs', '/api/notifications/admin/logs?limit=3', { admin: true });
})().catch((err) => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
