const crypto = require('crypto');

/**
 * OTPs are stored as a keyed hash so a database leak doesn't expose live codes.
 * `otpLookupValues` also matches legacy plain rows created before this change
 * (they expire within minutes).
 */
function pepper() {
  return process.env.OTP_PEPPER || process.env.JWT_SECRET || 'luvstor-otp';
}

function hashOtp(email, otp) {
  return crypto
    .createHmac('sha256', pepper())
    .update(`${String(email).trim().toLowerCase()}:${String(otp).trim()}`)
    .digest('hex');
}

function otpLookupValues(email, otp) {
  return { $in: [hashOtp(email, otp), String(otp).trim()] };
}

module.exports = { hashOtp, otpLookupValues };
