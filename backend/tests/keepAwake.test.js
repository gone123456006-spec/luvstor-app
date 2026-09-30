const test = require('node:test');
const assert = require('node:assert/strict');

const {
  keepAwakeUrl,
  startKeepAwake,
  stopKeepAwake,
  getKeepAwakeStats,
} = require('../utils/keepAwake');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] == null) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] == null) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('keep-alive targets the Render public URL /health', () => {
  withEnv(
    { RENDER_EXTERNAL_URL: 'https://luvstor-api.onrender.com/', KEEP_AWAKE: null, KEEP_AWAKE_URL: null },
    () => {
      assert.equal(keepAwakeUrl(5000), 'https://luvstor-api.onrender.com/health');
    },
  );
});

test('keep-alive falls back to the local port and can be disabled', () => {
  withEnv({ RENDER_EXTERNAL_URL: null, KEEP_AWAKE_URL: null, KEEP_AWAKE: null }, () => {
    assert.equal(keepAwakeUrl(5001), 'http://127.0.0.1:5001/health');
  });
  withEnv(
    { RENDER_EXTERNAL_URL: 'https://luvstor-api.onrender.com', KEEP_AWAKE: 'false' },
    () => {
      assert.equal(keepAwakeUrl(5000), null);
    },
  );
});

test('starting twice keeps a single interval; unreachable target never throws', async () => {
  await withEnv(
    {
      RENDER_EXTERNAL_URL: null,
      KEEP_AWAKE_URL: 'http://127.0.0.1:1',
      KEEP_AWAKE: null,
      KEEP_AWAKE_INTERVAL_MS: '250',
    },
    async () => {
      try {
        assert.equal(startKeepAwake(), true);
        assert.equal(startKeepAwake(), false);
        await new Promise((r) => setTimeout(r, 700));
        const stats = getKeepAwakeStats();
        assert.equal(stats.running, true);
        assert.equal(stats.intervalMs, 250);
        assert.ok(stats.failed >= 1, 'failed pings are counted, not thrown');
      } finally {
        stopKeepAwake();
      }
      assert.equal(getKeepAwakeStats().running, false);
    },
  );
});
