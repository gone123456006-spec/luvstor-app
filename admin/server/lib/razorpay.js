const { config } = require('../config');
const { HttpError, startOfUtcDay } = require('./http');
const { cached } = require('./cache');

function isConfigured() {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
}

async function rzp(path, params = {}) {
  if (!isConfigured()) throw new HttpError(503, 'Razorpay keys are not configured', 'RZP_OFF');
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
  let res;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}?${qs}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HttpError(502, `Razorpay unreachable: ${err.message}`, 'RZP_DOWN');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, data?.error?.description || `Razorpay error (${res.status})`, 'RZP_ERROR');
  }
  return data;
}

function shapePayment(p) {
  return {
    id: p.id,
    amount: (Number(p.amount) || 0) / 100,
    currency: p.currency,
    status: p.status,
    method: p.method,
    email: p.email || '',
    contact: p.contact || '',
    description: p.description || '',
    notes: p.notes && typeof p.notes === 'object' ? p.notes : {},
    orderId: p.order_id || '',
    errorReason: p.error_description || '',
    createdAt: new Date((Number(p.created_at) || 0) * 1000).toISOString(),
  };
}

async function listPayments({ from, to, count = 50, skip = 0 } = {}) {
  const data = await rzp('/payments', {
    from: from ? Math.floor(from.getTime() / 1000) : undefined,
    to: to ? Math.floor(to.getTime() / 1000) : undefined,
    count: Math.min(Math.max(count, 1), 100),
    skip: Math.max(skip, 0),
  });
  return (data.items || []).map(shapePayment);
}

/** Last N days of payments, paginated (capped) and cached for 5 minutes. */
function recentPayments(days = 30) {
  return cached(`rzp:recent:${days}`, 5 * 60 * 1000, async () => {
    const from = new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000);
    const all = [];
    for (let page = 0; page < 30; page += 1) {
      const batch = await listPayments({ from, count: 100, skip: page * 100 });
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  });
}

const ORDER_PAGE = 100;
const MAX_ORDER_PAGES = 50;

/**
 * The app tags every order: subscriptions carry notes.planId (+ type), token
 * packs carry notes.packId. Both carry notes.userId.
 */
function shapeOrder(o) {
  const notes = o.notes && typeof o.notes === 'object' && !Array.isArray(o.notes) ? o.notes : {};
  const kind = notes.planId || notes.type === 'subscription' ? 'subscription' : notes.packId ? 'tokens' : 'other';
  return {
    id: o.id,
    amount: (Number(o.amount_paid) || 0) / 100,
    status: o.status,
    receipt: o.receipt || '',
    kind,
    userId: String(notes.userId || ''),
    planId: String(notes.planId || ''),
    periodId: String(notes.periodId || ''),
    packId: String(notes.packId || ''),
    tokens: Number(notes.tokens) || null,
    createdAt: new Date((Number(o.created_at) || 0) * 1000).toISOString(),
  };
}

/**
 * Paid orders newest first. `days` null means all time. Capped at
 * MAX_ORDER_PAGES * ORDER_PAGE orders; `truncated` tells the caller.
 */
function paidOrders(days) {
  return cached(`rzp:orders:${days || 'all'}`, 5 * 60 * 1000, async () => {
    const from = days ? new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000) : null;
    const all = [];
    let truncated = false;
    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const data = await rzp('/orders', {
        from: from ? Math.floor(from.getTime() / 1000) : undefined,
        count: ORDER_PAGE,
        skip: page * ORDER_PAGE,
      });
      const items = data.items || [];
      all.push(...items);
      if (items.length < ORDER_PAGE) break;
      if (page === MAX_ORDER_PAGES - 1) truncated = true;
    }
    return { orders: all.filter((o) => o.status === 'paid').map(shapeOrder), truncated };
  });
}

module.exports = { isConfigured, listPayments, recentPayments, paidOrders, shapeOrder };
