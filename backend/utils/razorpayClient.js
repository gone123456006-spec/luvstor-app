const Razorpay = require('razorpay');

let razorpayClient = null;

/**
 * Lazy Razorpay client. Does not crash the process at require-time when
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing from .env.
 */
function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    const err = new Error(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env',
    );
    err.code = 'RAZORPAY_NOT_CONFIGURED';
    throw err;
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id, key_secret });
  }
  return razorpayClient;
}

function paymentUnavailable(res, err) {
  if (err?.code === 'RAZORPAY_NOT_CONFIGURED') {
    res.status(503).json({
      error: err.message,
      code: 'RAZORPAY_NOT_CONFIGURED',
    });
    return true;
  }
  return false;
}

module.exports = { getRazorpay, paymentUnavailable };
