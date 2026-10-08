/**
 * Message safe to send to clients: intentional 4xx messages pass through,
 * anything else (DB / SDK / bug) becomes the generic fallback.
 */
function publicErrorMessage(err, fallback = 'Server error') {
  const status = Number(err?.status || err?.statusCode || 500);
  if (status < 500 && err?.message) return err.message;
  return fallback;
}

module.exports = { publicErrorMessage };
