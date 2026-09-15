/**
 * Resolve which token pack to credit from a Razorpay order.
 * Pack identity MUST come from server-written order.notes, never from the client body alone.
 */
function resolvePaidPackFromOrder({ order, clientPackId, TOKEN_PACKS, getPackPriceInr, user }) {
  if (!order || typeof order !== 'object') {
    return { ok: false, status: 400, error: 'Could not verify order' };
  }

  const packId = String(order.notes?.packId || '');
  const pack = TOKEN_PACKS[packId];
  if (!pack) {
    return {
      ok: false,
      status: 400,
      error: 'Order missing valid pack',
      code: 'INVALID_ORDER_PACK',
    };
  }

  if (
    clientPackId != null &&
    String(clientPackId) !== '' &&
    String(clientPackId) !== packId
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Pack does not match paid order',
      code: 'PACK_MISMATCH',
    };
  }

  const notedPriceInr = Number(order.notes?.priceInr);
  const fallbackPrice = Number(getPackPriceInr(packId, user));
  const expectedPaise = Number.isFinite(notedPriceInr)
    ? notedPriceInr * 100
    : fallbackPrice * 100;

  if (!Number.isFinite(expectedPaise) || Number(order.amount) !== Number(expectedPaise)) {
    return {
      ok: false,
      status: 400,
      error: 'Payment amount does not match pack price',
      code: 'AMOUNT_MISMATCH',
    };
  }

  const notedTokens = Number(order.notes?.tokens);
  const credited =
    Number.isFinite(notedTokens) && notedTokens > 0 ? notedTokens : pack.tokens;

  return { ok: true, packId, pack, credited };
}

module.exports = { resolvePaidPackFromOrder };
