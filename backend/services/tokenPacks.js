/**
 * Token pack catalog + progressive pricing for the ₹10 / 10-token pack only.
 *
 * Pack "10" offer ladder (per user):
 *   1st purchase → ₹4
 *   2nd purchase → ₹7
 *   3rd+         → ₹9 (stays at ₹9)
 * List price remains ₹10 for display.
 */
const TOKEN_PACKS = {
  '10': { tokens: 10, listPriceInr: 10 },
  '100': { tokens: 100, listPriceInr: 80 },
  '500': { tokens: 500, listPriceInr: 350 },
  '1000': { tokens: 1000, listPriceInr: 600 },
  '5000': { tokens: 5000, listPriceInr: 2000 },
  '10000': { tokens: 10000, listPriceInr: 3000 },
  '50000': { tokens: 50000, listPriceInr: 10000 },
  '100000': { tokens: 100000, listPriceInr: 15000 },
};

const PACK_10_ID = '10';

/** Prices charged for pack 10 by completed purchase count (0 = never bought). */
function getPack10PriceInr(purchaseCount) {
  const n = Math.max(0, Number(purchaseCount) || 0);
  if (n <= 0) return 4;
  if (n === 1) return 7;
  return 9;
}

function getPackPriceInr(packId, user) {
  const pack = TOKEN_PACKS[packId];
  if (!pack) return null;
  if (String(packId) === PACK_10_ID) {
    return getPack10PriceInr(user?.tokenPack10PurchaseCount);
  }
  return pack.listPriceInr;
}

function serializePacksForUser(user) {
  const count = Math.max(0, Number(user?.tokenPack10PurchaseCount) || 0);
  return Object.entries(TOKEN_PACKS).map(([id, pack]) => {
    const priceInr = getPackPriceInr(id, user);
    const listPriceInr = pack.listPriceInr;
    const isOffer = id === PACK_10_ID && priceInr < listPriceInr;
    let offerLabel = '';
    if (id === PACK_10_ID) {
      if (count <= 0) offerLabel = 'New user · ₹4';
      else if (count === 1) offerLabel = 'Special · ₹7';
      else if (priceInr < listPriceInr) offerLabel = '₹9 deal';
    }
    return {
      id,
      tokens: pack.tokens,
      listPriceInr,
      priceInr,
      pricePaise: priceInr * 100,
      isOffer,
      offerLabel,
      pack10PurchaseCount: id === PACK_10_ID ? count : undefined,
    };
  });
}

module.exports = {
  TOKEN_PACKS,
  PACK_10_ID,
  getPack10PriceInr,
  getPackPriceInr,
  serializePacksForUser,
};
