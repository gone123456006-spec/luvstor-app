#!/usr/bin/env node
/**
 * Offline simulation of the 7-day Nearby rotation.
 *
 * Runs the real ranking engine (services/discoveryRotation.js) against a
 * synthetic population for N consecutive days and prints, per day, how many
 * profiles were fresh vs repeated and how much each day overlaps the previous
 * one. No database or network access.
 *
 *   node scripts/simulateDiscoveryRotation.js [--users=70] [--viewers=3]
 *                                             [--days=7] [--batch=25]
 */

const {
  rotationDayKey,
  rotationBucketForDay,
  selectDiscoveryBatch,
  TIER,
} = require('../services/discoveryRotation');

const DAY_MS = 24 * 60 * 60 * 1000;

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
}

const USER_COUNT = arg('users', 70);
const VIEWER_COUNT = arg('viewers', 3);
const DAYS = arg('days', 7);
const BATCH = arg('batch', 25);
const START = new Date('2025-03-03T09:00:00.000Z');

const VIEWER = { id: 'viewer', gender: 'Woman' };

function buildPopulation(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `user-${String(i + 1).padStart(4, '0')}`,
    name: `User ${i + 1}`,
    photo: 'photo.jpg',
    bio: 'hi',
    age: 21 + (i % 15),
    interests: ['music'],
    // Spread across every distance band so the mix is observable.
    distance: 200 + i * 1800,
    createdAt: new Date(START.getTime() - 60 * DAY_MS),
    isOnline: i % 5 === 0,
    lastSeen: new Date(START.getTime() - (i % 10) * DAY_MS),
    plan: i % 20 === 0 ? 'gold' : 'free',
    topSpot: false,
    // A few already-popular profiles, to show exposure fairness at work.
    exposureCount: i % 9 === 0 ? 200 : i % 3,
    // Two thirds have saved filters; a third of those exclude the viewer.
    prefs:
      i % 3 === 0
        ? null
        : { gender: i % 6 === 1 ? 'man' : 'woman', radiusKm: 50 },
  }));
}

function simulateViewer(viewerId, population, days, exposure) {
  const history = new Map();
  const rows = [];
  let previousIds = new Set();

  for (let day = 0; day < days; day += 1) {
    const now = new Date(START.getTime() + day * DAY_MS);
    const rotationBucket = rotationBucketForDay(rotationDayKey(now));

    // A late joiner appears midway through the cycle.
    const withNewcomer =
      day >= 3
        ? [
            ...population,
            {
              ...population[0],
              id: 'newcomer-0001',
              name: 'Newcomer',
              createdAt: new Date(START.getTime() + 3 * DAY_MS),
              exposureCount: 0,
            },
          ]
        : population;

    // Exposure is global, so it accumulates across every viewer's batches.
    const candidates = withNewcomer.map((c) => ({
      ...c,
      exposureCount: (c.exposureCount || 0) + (exposure.get(c.id) || 0),
    }));

    const { selected, diagnostics } = selectDiscoveryBatch({
      viewerId,
      candidates,
      impressions: history,
      targetCount: BATCH,
      now,
      rotationBucket,
      viewer: VIEWER,
    });

    const ids = selected.map((u) => u.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new Error(`duplicate profile inside day ${day + 1} batch for ${viewerId}`);
    }

    const fresh = selected.filter((u) => u.rotationTier <= TIER.UNSEEN_OTHER_BUCKET).length;
    const repeatedFromYesterday = ids.filter((id) => previousIds.has(id)).length;

    for (const id of ids) {
      const prev = history.get(id);
      history.set(id, {
        firstShownAt: prev?.firstShownAt || now,
        lastShownAt: now,
        impressionCount: (prev?.impressionCount || 0) + 1,
      });
      exposure.set(id, (exposure.get(id) || 0) + 1);
    }

    rows.push({
      day: day + 1,
      bucket: rotationBucket,
      served: ids.length,
      fresh,
      repeats: ids.length - fresh,
      sameAsYesterday: repeatedFromYesterday,
      newcomerServed: ids.includes('newcomer-0001') ? 'yes' : '-',
      online: selected.filter((u) => u.isOnline).length,
      bands: Object.keys(diagnostics.bandCounts).length,
      slots: diagnostics.slotCounts,
      tiers: diagnostics.tierCounts,
      lowSupply: diagnostics.lowSupply,
    });
    previousIds = unique;
  }

  return { rows, history };
}

function main() {
  const population = buildPopulation(USER_COUNT);
  console.log(
    `\n7-day Nearby rotation simulation — ${USER_COUNT} eligible users, ` +
      `${VIEWER_COUNT} viewers, ${DAYS} days, batch ${BATCH}\n`,
  );

  // Impressions are global, so every viewer's batches feed the same counters.
  const exposure = new Map();

  for (let v = 0; v < VIEWER_COUNT; v += 1) {
    const viewerId = `viewer-${String(v + 1).padStart(4, '0')}`;
    const { rows, history } = simulateViewer(viewerId, population, DAYS, exposure);

    console.log(`── ${viewerId} ${'─'.repeat(40)}`);
    console.table(
      rows.map((r) => ({
        day: r.day,
        bucket: r.bucket,
        served: r.served,
        fresh: r.fresh,
        repeats: r.repeats,
        'repeat of yesterday': r.sameAsYesterday,
        newcomer: r.newcomerServed,
        online: r.online,
        'distance bands': r.bands,
        'low supply': r.lowSupply ? 'yes' : '-',
      })),
    );

    console.log('   reserved slots claimed per day:');
    console.table(rows.map((r) => ({ day: r.day, ...r.slots })));

    const distinct = history.size;
    console.log(
      `   distinct profiles seen over ${DAYS} days: ${distinct}/${population.length}` +
        ` (${((distinct / population.length) * 100).toFixed(0)}% of the pool)\n`,
    );
  }

  // Exposure fairness: no profile should have absorbed far more impressions
  // than the rest of the pool.
  const counts = [...exposure.values()].sort((a, b) => b - a);
  if (counts.length) {
    console.log(
      `Exposure spread across ${counts.length} profiles — ` +
        `busiest ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, ` +
        `quietest ${counts[counts.length - 1]}\n`,
    );
  }

  // Cross-viewer check: day 1 must differ per viewer (viewer-specific buckets).
  const { rows: rowsA } = simulateViewer('viewer-0001', population, 1, new Map());
  const { rows: rowsB } = simulateViewer('viewer-0002', population, 1, new Map());
  console.log(
    `Viewer-specific rotation: viewer-0001 bucket ${rowsA[0].bucket}, ` +
      `viewer-0002 bucket ${rowsB[0].bucket} (same day, different candidate sets)\n`,
  );
}

main();
