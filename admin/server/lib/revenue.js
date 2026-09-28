const { startOfUtcDay } = require('./http');

const DAY = 86_400_000;

function addTo(map, key, amount) {
  const row = map[key] || (map[key] = { amount: 0, count: 0 });
  row.amount += amount;
  row.count += 1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function roundRows(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { amount: round2(v.amount), count: v.count }]));
}

/** Daily series for short ranges, monthly for long ones. */
function buildSeries(orders, days) {
  if (days && days <= 90) {
    const today = startOfUtcDay().getTime();
    const buckets = new Map();
    for (let i = days - 1; i >= 0; i -= 1) buckets.set(new Date(today - i * DAY).toISOString().slice(0, 10), 0);
    for (const o of orders) {
      const key = o.createdAt.slice(0, 10);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + o.amount);
    }
    return { unit: 'day', points: [...buckets].map(([date, value]) => ({ date, value: round2(value) })) };
  }
  const now = new Date();
  const oldest = orders.length ? new Date(orders[orders.length - 1].createdAt) : now;
  const months = [];
  const cursor = new Date(Date.UTC(oldest.getUTCFullYear(), oldest.getUTCMonth(), 1));
  if (days) {
    const start = new Date(now.getTime() - (days - 1) * DAY);
    cursor.setTime(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  }
  while (cursor <= now && months.length < 120) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const buckets = new Map(months.map((m) => [m, 0]));
  for (const o of orders) {
    const key = o.createdAt.slice(0, 7);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + o.amount);
  }
  return { unit: 'month', points: [...buckets].map(([date, value]) => ({ date, value: round2(value) })) };
}

/** Gross revenue split from paid Razorpay orders (refunds are not deducted). */
function summarizeOrders(orders, days) {
  let total = 0;
  const byKind = {};
  const byPlan = {};
  const byPack = {};
  for (const o of orders) {
    total += o.amount;
    addTo(byKind, o.kind, o.amount);
    if (o.kind === 'subscription') addTo(byPlan, o.planId || 'unknown', o.amount);
    if (o.kind === 'tokens') addTo(byPack, o.packId || 'unknown', o.amount);
  }
  const payers = new Set(orders.map((o) => o.userId).filter(Boolean)).size;
  return {
    total: round2(total),
    orders: orders.length,
    payers,
    averageOrder: orders.length ? round2(total / orders.length) : 0,
    subscriptions: roundRows(byKind).subscription || { amount: 0, count: 0 },
    tokens: roundRows(byKind).tokens || { amount: 0, count: 0 },
    other: roundRows(byKind).other || { amount: 0, count: 0 },
    byPlan: roundRows(byPlan),
    byPack: roundRows(byPack),
    series: buildSeries(orders, days),
  };
}

module.exports = { summarizeOrders, buildSeries };
