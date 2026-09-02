const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROTATION_BUCKETS,
  TIER,
  bucketForPair,
  rotationDayKey,
  rotationBucketForDay,
  classifyCandidate,
  selectDiscoveryBatch,
  NEW_USER_WINDOW_MS,
  SECOND_CHANCE_MIN_MS,
  SECOND_CHANCE_MAX_MS,
  EXPLORATION_MAX_EXPOSURE,
  SCORE_WEIGHTS,
  distanceBand,
  mutualRelevanceScore,
  exposureScore,
  resolveSlotQuotas,
} = require('../services/discoveryRotation');

const { buildEligibilityFilter } = require('../services/discovery');

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TIME = new Date('2025-03-03T09:00:00.000Z');
const OLD_ACCOUNT = new Date('2024-01-01T00:00:00.000Z');
const VIEWER = 'viewer-aaaaaaaaaaaaaaaa';

function makeCandidates(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `cand-${String(i + 1).padStart(4, '0')}`,
    name: `User ${i + 1}`,
    photo: 'photo.jpg',
    bio: 'hello',
    age: 25,
    interests: ['music'],
    // Ascending distance so distance-based ordering is easy to detect.
    distance: (i + 1) * 250,
    createdAt: OLD_ACCOUNT,
    isOnline: false,
    lastSeen: OLD_ACCOUNT,
    plan: 'free',
    topSpot: false,
    ...overrides,
  }));
}

/** In-memory stand-in for the DiscoveryImpression collection. */
function createImpressionStore(initial = []) {
  const map = new Map(initial);
  return {
    map,
    get: (id) => map.get(id),
    record(ids, now) {
      for (const id of ids) {
        const prev = map.get(id);
        map.set(id, {
          firstShownAt: prev?.firstShownAt || now,
          lastShownAt: now,
          impressionCount: (prev?.impressionCount || 0) + 1,
        });
      }
    },
  };
}

function runDay({ viewerId = VIEWER, candidates, store, dayIndex = 0, targetCount = 25 }) {
  const now = new Date(BASE_TIME.getTime() + dayIndex * DAY_MS);
  const rotationBucket = rotationBucketForDay(rotationDayKey(now));
  const result = selectDiscoveryBatch({
    viewerId,
    candidates,
    impressions: store.map,
    targetCount,
    now,
    rotationBucket,
  });
  store.record(
    result.selected.map((u) => u.id),
    now,
  );
  return { ...result, now, rotationBucket };
}

function idsOf(list) {
  return list.map((u) => u.id);
}

/**
 * Buckets are a deterministic hash, so a fixture that needs a candidate in (or
 * out of) a specific bucket must search for a matching id rather than hope.
 */
function idInBucket(viewerId, prefix, bucket) {
  for (let i = 0; i < 10000; i += 1) {
    const id = `${prefix}-${i}`;
    if (bucketForPair(viewerId, id) === bucket) return id;
  }
  throw new Error(`no id found for bucket ${bucket}`);
}

function idOutsideBucket(viewerId, prefix, bucket) {
  for (let i = 0; i < 10000; i += 1) {
    const id = `${prefix}-${i}`;
    if (bucketForPair(viewerId, id) !== bucket) return id;
  }
  throw new Error(`no id found outside bucket ${bucket}`);
}

/** `count` distinct ids that all hash into the same bucket for this viewer. */
function idsInBucket(viewerId, prefix, bucket, count) {
  const ids = [];
  for (let i = 0; ids.length < count && i < 100000; i += 1) {
    const id = `${prefix}-${i}`;
    if (bucketForPair(viewerId, id) === bucket) ids.push(id);
  }
  if (ids.length < count) throw new Error(`only found ${ids.length} ids in bucket ${bucket}`);
  return ids;
}

/** `count` distinct ids that all avoid a bucket for this viewer. */
function idsOutsideBucket(viewerId, prefix, bucket, count) {
  const ids = [];
  for (let i = 0; ids.length < count && i < 100000; i += 1) {
    const id = `${prefix}-${i}`;
    if (bucketForPair(viewerId, id) !== bucket) ids.push(id);
  }
  if (ids.length < count) throw new Error(`only found ${ids.length} ids outside bucket ${bucket}`);
  return ids;
}

// ── Bucket + rotation-day primitives ───────────────────────────────────────

test('bucket assignment is deterministic and inside 0..6', () => {
  for (let i = 0; i < 200; i += 1) {
    const bucket = bucketForPair(VIEWER, `cand-${i}`);
    assert.ok(Number.isInteger(bucket));
    assert.ok(bucket >= 0 && bucket < ROTATION_BUCKETS);
    assert.equal(bucket, bucketForPair(VIEWER, `cand-${i}`));
  }
});

test('the same candidate lands in different buckets for different viewers', () => {
  const candidateIds = makeCandidates(300).map((c) => c.id);
  const forA = candidateIds.map((id) => bucketForPair('viewer-A', id));
  const forB = candidateIds.map((id) => bucketForPair('viewer-B', id));
  const identical = forA.filter((b, i) => b === forB[i]).length;
  // Independent hashes overlap ~1/7 of the time; anywhere near 100% would mean
  // every viewer shares one global rotation.
  assert.ok(identical < candidateIds.length * 0.35, `overlap too high: ${identical}/300`);
});

test('buckets spread candidates reasonably evenly', () => {
  const counts = new Array(ROTATION_BUCKETS).fill(0);
  for (const c of makeCandidates(7000)) counts[bucketForPair(VIEWER, c.id)] += 1;
  for (const count of counts) {
    assert.ok(count > 700 && count < 1300, `unbalanced bucket: ${counts.join(',')}`);
  }
});

test('rotation day advances one bucket per calendar day and wraps after 7', () => {
  const buckets = [];
  for (let d = 0; d < 8; d += 1) {
    buckets.push(rotationBucketForDay(rotationDayKey(new Date(BASE_TIME.getTime() + d * DAY_MS))));
  }
  for (let d = 1; d < 8; d += 1) {
    assert.equal(buckets[d], (buckets[d - 1] + 1) % ROTATION_BUCKETS);
  }
  assert.equal(buckets[7], buckets[0]);
});

test('rotation day is server-side only and ignores client-supplied values', () => {
  const morning = new Date('2025-03-03T00:05:00.000Z');
  const night = new Date('2025-03-03T23:55:00.000Z');
  assert.equal(rotationDayKey(morning), rotationDayKey(night));
  assert.notEqual(rotationDayKey(morning), rotationDayKey(new Date('2025-03-04T00:05:00.000Z')));
});

// ── Scenario 1: more than 100 fresh nearby users ───────────────────────────

test('scenario 1: 120 fresh users returns exactly 25 unseen, no duplicates', () => {
  const store = createImpressionStore();
  const { selected, diagnostics } = runDay({ candidates: makeCandidates(120), store });

  assert.equal(selected.length, 25);
  assert.equal(new Set(idsOf(selected)).size, 25);
  assert.equal(diagnostics.exhausted, false);
  for (const u of selected) {
    assert.ok(u.rotationTier <= TIER.UNSEEN_OTHER_BUCKET, 'served a repeat while fresh users existed');
  }
});

// ── Scenario 2 & 3: exact and small pools ──────────────────────────────────

test('scenario 2: exactly 25 eligible users returns all 25', () => {
  const store = createImpressionStore();
  const { selected, diagnostics } = runDay({ candidates: makeCandidates(25), store });
  assert.equal(selected.length, 25);
  assert.equal(diagnostics.exhausted, true);
});

test('scenario 3: 18 eligible users returns 18 without padding or duplicates', () => {
  const store = createImpressionStore();
  const { selected } = runDay({ candidates: makeCandidates(18), store });
  assert.equal(selected.length, 18);
  assert.equal(new Set(idsOf(selected)).size, 18);
});

test('scenario 3b: a fully-seen small pool still fills via controlled repeats', () => {
  const candidates = makeCandidates(18);
  const store = createImpressionStore();
  runDay({ candidates, store, dayIndex: 0 });

  const { selected } = runDay({ candidates, store, dayIndex: 1 });
  assert.equal(selected.length, 18, 'small user base must not go empty because of the 7-day rule');
  assert.equal(new Set(idsOf(selected)).size, 18);
});

// ── Scenario 4: today's bucket is smaller than the target ──────────────────

test("scenario 4: a short today-bucket is topped up from other buckets, still all unseen", () => {
  const candidates = makeCandidates(70);
  const store = createImpressionStore();
  const { selected, rotationBucket } = runDay({ candidates, store });

  assert.equal(selected.length, 25);
  const todaysBucketTotal = candidates.filter(
    (c) => bucketForPair(VIEWER, c.id) === rotationBucket,
  ).length;
  assert.ok(todaysBucketTotal < 25, 'fixture should have fewer than 25 in today bucket');

  // Everyone served is still unseen — other buckets were used before repeats.
  for (const u of selected) {
    assert.ok(u.rotationTier <= TIER.UNSEEN_OTHER_BUCKET);
  }
  // Today's bucket is served first.
  const fromToday = selected.filter((u) => u.rotationBucket === rotationBucket);
  assert.equal(fromToday.length, todaysBucketTotal);
  for (let i = 0; i < todaysBucketTotal; i += 1) {
    assert.equal(selected[i].rotationBucket, rotationBucket);
  }
});

// ── Scenario 5 & 6: consecutive days ───────────────────────────────────────

test('scenario 6: consecutive days serve different people while fresh supply lasts', () => {
  const candidates = makeCandidates(70);
  const store = createImpressionStore();

  const day1 = runDay({ candidates, store, dayIndex: 0 });
  const day2 = runDay({ candidates, store, dayIndex: 1 });

  assert.equal(day1.selected.length, 25);
  assert.equal(day2.selected.length, 25);

  const day1Ids = new Set(idsOf(day1.selected));
  const overlap = idsOf(day2.selected).filter((id) => day1Ids.has(id));
  assert.equal(overlap.length, 0, 'day 2 repeated day 1 profiles despite unseen supply');
});

test('scenario 5/7-day sweep: 70 users over 7 days keeps repeats minimal and ordered', () => {
  const candidates = makeCandidates(70);
  const store = createImpressionStore();
  const perDay = [];

  for (let day = 0; day < 7; day += 1) {
    perDay.push(runDay({ candidates, store, dayIndex: day }));
  }

  for (const day of perDay) {
    assert.equal(day.selected.length, 25);
    assert.equal(new Set(idsOf(day.selected)).size, 25, 'duplicate inside a single batch');
  }

  // Days 1–2 exhaust 50 unseen, day 3 finishes the last 20 and needs 5 repeats.
  const day3 = perDay[2];
  const repeats = day3.selected.filter((u) => u.rotationTier > TIER.UNSEEN_OTHER_BUCKET);
  assert.equal(day3.selected.length - repeats.length, 20, 'unseen users were not exhausted first');
  assert.equal(repeats.length, 5);

  // Repeats must come from day 1, never from yesterday.
  const day1Ids = new Set(idsOf(perDay[0].selected));
  for (const u of repeats) {
    assert.ok(day1Ids.has(u.id), 'repeat pulled from a more recent day than necessary');
  }
});

test('scenario 5: partially viewed buckets still prefer whatever is unseen', () => {
  const candidates = makeCandidates(70);
  const store = createImpressionStore();
  // Mark one candidate from every bucket as seen a long time ago.
  const seeded = [];
  for (let bucket = 0; bucket < ROTATION_BUCKETS; bucket += 1) {
    const match = candidates.find((c) => bucketForPair(VIEWER, c.id) === bucket);
    if (match) seeded.push(match.id);
  }
  store.record(seeded, new Date(BASE_TIME.getTime() - 2 * DAY_MS));

  const { selected } = runDay({ candidates, store });
  assert.equal(selected.length, 25);
  const seededSet = new Set(seeded);
  assert.equal(
    idsOf(selected).filter((id) => seededSet.has(id)).length,
    0,
    'already-seen users were served while unseen ones remained',
  );
});

// ── Scenario 7: viewer-specific history ────────────────────────────────────

test('scenario 7: one viewer seeing a candidate never hides them from other viewers', () => {
  const candidates = makeCandidates(40);
  const storeA = createImpressionStore();
  const viewerASelection = runDay({ viewerId: 'viewer-A', candidates, store: storeA });
  const shownToA = new Set(idsOf(viewerASelection.selected));
  assert.ok(shownToA.size > 0);

  // Viewer B has an empty history of their own.
  for (const otherViewer of ['viewer-B', 'viewer-C', 'viewer-D']) {
    const store = createImpressionStore();
    const { selected } = runDay({ viewerId: otherViewer, candidates, store });
    for (const u of selected) {
      assert.ok(u.rotationTier <= TIER.UNSEEN_OTHER_BUCKET, 'history leaked across viewers');
    }
    const reachable = idsOf(selected).filter((id) => shownToA.has(id));
    assert.ok(reachable.length > 0, 'candidates seen by viewer A became invisible to others');
  }
});

// ── Scenario 8: new users mid-cycle ────────────────────────────────────────

test('scenario 8: a newly registered user is inserted before other-bucket unseen users', () => {
  const now = new Date(BASE_TIME.getTime() + 3 * DAY_MS);
  const rotationBucket = rotationBucketForDay(rotationDayKey(now));

  // Pool of unseen users that are deliberately NOT in today's bucket.
  const candidates = makeCandidates(200).filter(
    (c) => bucketForPair(VIEWER, c.id) !== rotationBucket,
  );
  assert.ok(candidates.length > 100);

  // The newcomer is forced out of today's bucket too, so only the new-user
  // boost — not the bucket — can lift them into the batch.
  const newcomerId = idOutsideBucket(VIEWER, 'newcomer', rotationBucket);
  const newcomer = {
    ...makeCandidates(1)[0],
    id: newcomerId,
    createdAt: new Date(now.getTime() - DAY_MS),
    // Deliberately the furthest away, to prove freshness carried them.
    distance: 999999,
  };
  assert.notEqual(bucketForPair(VIEWER, newcomerId), rotationBucket);

  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...candidates, newcomer],
    impressions: new Map(),
    targetCount: 25,
    now,
    rotationBucket,
  });

  const found = selected.find((u) => u.id === newcomerId);
  assert.ok(found, 'newly registered nearby user did not reach the batch');
  assert.equal(found.rotationTier, TIER.UNSEEN_NEW_USER);
  assert.equal(selected[0].id, newcomerId, 'new user should outrank other-bucket unseen users');
});

test('the new-user boost expires after the freshness window', () => {
  const now = new Date(BASE_TIME.getTime());
  const rotationBucket = rotationBucketForDay(rotationDayKey(now));
  const staleId = idOutsideBucket(VIEWER, 'stale', rotationBucket);
  const stale = {
    ...makeCandidates(1)[0],
    id: staleId,
    createdAt: new Date(now.getTime() - NEW_USER_WINDOW_MS - DAY_MS),
  };
  assert.notEqual(bucketForPair(VIEWER, staleId), rotationBucket);

  const { tier } = classifyCandidate(stale, null, {
    now: now.getTime(),
    rotationBucket,
    viewerId: VIEWER,
  });
  assert.equal(tier, TIER.UNSEEN_OTHER_BUCKET);
});

test('an account created inside the window but in today\'s bucket still ranks top', () => {
  const now = new Date(BASE_TIME.getTime());
  const rotationBucket = rotationBucketForDay(rotationDayKey(now));
  const id = idInBucket(VIEWER, 'today', rotationBucket);
  const { tier } = classifyCandidate(
    { ...makeCandidates(1)[0], id, createdAt: now },
    null,
    { now: now.getTime(), rotationBucket, viewerId: VIEWER },
  );
  assert.equal(tier, TIER.UNSEEN_TODAY_BUCKET);
});

// ── Scenario 9: blocked / excluded users ───────────────────────────────────

test('scenario 9: excluded (blocked) ids never appear, even when the batch cannot fill', () => {
  const candidates = makeCandidates(30);
  const blocked = idsOf(candidates.slice(0, 20));
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
    excludeIds: blocked,
  });

  assert.equal(selected.length, 10, 'filters must not be relaxed to reach 25');
  for (const id of blocked) {
    assert.ok(!idsOf(selected).includes(id), 'a blocked user was served');
  }
});

test('the viewer is never shown to themselves', () => {
  const candidates = [...makeCandidates(5), { ...makeCandidates(1)[0], id: VIEWER }];
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.ok(!idsOf(selected).includes(VIEWER));
});

// ── Scenario 10: repeats only as a last resort, in the right order ─────────

test('scenario 10: unseen users are served before any repeat, then oldest/least-shown first', () => {
  const candidates = makeCandidates(30);
  const store = createImpressionStore();

  // 25 seen at different times and frequencies; 5 never seen.
  const seen = candidates.slice(0, 25);
  seen.forEach((c, i) => {
    store.map.set(c.id, {
      // c[0] oldest ... c[24] most recent
      lastShownAt: new Date(BASE_TIME.getTime() - (25 - i) * DAY_MS),
      firstShownAt: new Date(BASE_TIME.getTime() - 40 * DAY_MS),
      impressionCount: i === 0 ? 9 : 1,
    });
  });

  const { selected } = runDay({ candidates, store });
  assert.equal(selected.length, 25);

  const unseenIds = new Set(idsOf(candidates.slice(25)));
  const firstFive = idsOf(selected).slice(0, 5);
  for (const id of firstFive) {
    assert.ok(unseenIds.has(id), 'a repeat was ranked above an unseen profile');
  }

  const repeats = selected.slice(5);
  const lastShown = repeats.map((u) => store.map.get(u.id).lastShownAt.getTime());
  // Repeats arrive oldest-first.
  for (let i = 1; i < lastShown.length; i += 1) {
    assert.ok(lastShown[i] >= lastShown[i - 1], 'repeat ordering ignored lastShownAt');
  }
  // The five most recently shown profiles are dropped entirely rather than
  // re-served while older ones are still available.
  const servedIds = new Set(idsOf(selected));
  for (const c of candidates.slice(20, 25)) {
    assert.ok(!servedIds.has(c.id), `recently shown ${c.id} was repeated too soon`);
  }
});

test('freshness outweighs distance: a far unseen user beats a close one seen yesterday', () => {
  const nearButSeen = { ...makeCandidates(1)[0], id: 'near-seen', distance: 1000 };
  const farButFresh = { ...makeCandidates(1)[0], id: 'far-fresh', distance: 4000 };
  const impressions = new Map([
    ['near-seen', { lastShownAt: new Date(BASE_TIME.getTime() - DAY_MS / 2), impressionCount: 1 }],
  ]);

  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [nearButSeen, farButFresh],
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: bucketForPair(VIEWER, 'far-fresh'),
  });
  assert.equal(selected[0].id, 'far-fresh');
});

test('lower impression count wins when two repeats were last shown together', () => {
  const candidates = makeCandidates(2);
  const sameMoment = new Date(BASE_TIME.getTime() - 10 * DAY_MS);
  const impressions = new Map([
    [candidates[0].id, { lastShownAt: sameMoment, impressionCount: 12 }],
    [candidates[1].id, { lastShownAt: sameMoment, impressionCount: 2 }],
  ]);
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.equal(selected[0].id, candidates[1].id);
});

test('the paid discover top spot keeps its guaranteed placement', () => {
  const candidates = makeCandidates(60);
  const promoted = { ...candidates[59], topSpot: true, plan: 'black' };
  const impressions = new Map([
    [promoted.id, { lastShownAt: BASE_TIME, impressionCount: 30 }],
  ]);
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...candidates.slice(0, 59), promoted],
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.equal(selected[0].id, promoted.id);
});

// ── Scenario 11 & 12: duplicates and pagination ───────────────────────────

test('an unseen profile one ring out still beats a repeat inside the radius', () => {
  // The starvation case: the viewer's own radius is fully seen, but there are
  // unseen people just outside it. Serving repeats here is exactly the stale
  // feed the rotation exists to prevent.
  const nearSeen = makeCandidates(30).map((c) => ({
    ...c,
    id: `near-${c.id}`,
    ring: 0,
    distance: 800,
  }));
  const farUnseen = makeCandidates(30).map((c) => ({
    ...c,
    id: `far-${c.id}`,
    ring: 1,
    distance: 30000,
  }));
  const impressions = new Map(
    nearSeen.map((c) => [c.id, { lastShownAt: new Date(BASE_TIME.getTime() - 3600_000), impressionCount: 4 }]),
  );

  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...nearSeen, ...farUnseen],
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });

  assert.equal(selected.length, 25);
  assert.equal(
    selected.every((u) => u.rotationTier <= TIER.UNSEEN_OTHER_BUCKET),
    true,
    'repeats were served while unseen people existed one ring out',
  );
  assert.equal(selected.every((u) => u.id.startsWith('far-')), true);
});

test('repeats fall back to the nearest ring once every ring is exhausted', () => {
  const nearSeen = makeCandidates(10).map((c) => ({ ...c, id: `near-${c.id}`, ring: 0 }));
  const farSeen = makeCandidates(10).map((c) => ({ ...c, id: `far-${c.id}`, ring: 2 }));
  const shownAt = new Date(BASE_TIME.getTime() - 2 * DAY_MS);
  const impressions = new Map(
    [...nearSeen, ...farSeen].map((c) => [c.id, { lastShownAt: shownAt, impressionCount: 1 }]),
  );

  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...farSeen, ...nearSeen],
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });

  assert.equal(selected.length, 20);
  assert.equal(selected.slice(0, 10).every((u) => u.id.startsWith('near-')), true);
});

test('the configured radius orders equally fresh people: in-radius unseen come first', () => {
  const inRadius = makeCandidates(5).map((c) => ({ ...c, ring: 0, distance: 900 }));
  const farAway = makeCandidates(60)
    .slice(5)
    .map((c) => ({ ...c, id: `far-${c.id}`, ring: 2, distance: 80000 }));

  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...farAway, ...inRadius],
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });

  assert.equal(selected.length, 25);
  for (let i = 0; i < inRadius.length; i += 1) {
    assert.equal(selected[i].ring, 0, 'a far-away profile jumped ahead of an unseen neighbour');
  }
  assert.equal(selected.slice(5).every((u) => u.ring === 2), true);
});

test('within one ring, the rotation still decides the order', () => {
  const candidates = makeCandidates(60).map((c) => ({ ...c, ring: 0 }));
  const store = createImpressionStore();
  const day1 = runDay({ candidates, store, dayIndex: 0 });
  const day2 = runDay({ candidates, store, dayIndex: 1 });
  const day1Ids = new Set(idsOf(day1.selected));
  assert.equal(idsOf(day2.selected).filter((id) => day1Ids.has(id)).length, 0);
});

test('scenario 11: a duplicated candidate pool still yields unique profiles', () => {
  const candidates = makeCandidates(40);
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: [...candidates, ...candidates],
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.equal(selected.length, 25);
  assert.equal(new Set(idsOf(selected)).size, 25);
});

test('scenario 12: load-more never repeats an already loaded profile', () => {
  const candidates = makeCandidates(120);
  const store = createImpressionStore();
  const page1 = runDay({ candidates, store });

  const sessionExcluded = idsOf(page1.selected);
  const page2 = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions: store.map,
    targetCount: 25,
    now: page1.now,
    rotationBucket: page1.rotationBucket,
    excludeIds: sessionExcluded,
  });
  const page3 = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions: store.map,
    targetCount: 25,
    now: page1.now,
    rotationBucket: page1.rotationBucket,
    excludeIds: [...sessionExcluded, ...idsOf(page2.selected)],
  });

  const all = [...sessionExcluded, ...idsOf(page2.selected), ...idsOf(page3.selected)];
  assert.equal(all.length, 75);
  assert.equal(new Set(all).size, 75, 'pagination returned a profile twice in one session');
});

test('scenario 13: identical concurrent requests produce identical batches', () => {
  const candidates = makeCandidates(120);
  const impressions = new Map();
  const args = {
    viewerId: VIEWER,
    candidates,
    impressions,
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 2,
  };
  const a = selectDiscoveryBatch(args);
  const b = selectDiscoveryBatch(args);
  assert.deepEqual(idsOf(a.selected), idsOf(b.selected));
});

test('page order is stable for the same session inputs', () => {
  const candidates = makeCandidates(80);
  const args = {
    viewerId: VIEWER,
    candidates: [...candidates].reverse(),
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 4,
  };
  const first = selectDiscoveryBatch(args);
  const second = selectDiscoveryBatch({ ...args, candidates });
  // Input order must not change the ranking outcome.
  assert.deepEqual(idsOf(first.selected), idsOf(second.selected));
});

// ── Scenario 14: eligibility filters still applied in the database ─────────

test('scenario 14: eligibility filter keeps gender, activity, verification and visibility rules', () => {
  const filter = buildEligibilityFilter({
    excludeOids: [],
    genderFilter: 'woman',
    activeWithinMinutes: 60,
  });

  assert.equal(filter.isVerified, true);
  assert.deepEqual(filter.isDeactivated, { $ne: true });
  assert.equal(filter.deletionScheduledAt, null);
  assert.deepEqual(filter.name, { $nin: [null, ''] });
  assert.ok(filter.gender instanceof RegExp);
  assert.ok(filter.gender.test('Woman'));
  assert.ok(!filter.gender.test('Man'));
  assert.ok(Array.isArray(filter.$or));
  assert.equal(filter.$or.length, 2);
});

test('gender filter is omitted when the viewer selects "all"', () => {
  const filter = buildEligibilityFilter({ excludeOids: [], genderFilter: 'all', activeWithinMinutes: 0 });
  assert.equal(filter.gender, undefined);
  assert.equal(filter.$or, undefined);
});

test('a zero target returns nothing rather than a default batch', () => {
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: makeCandidates(50),
    impressions: new Map(),
    targetCount: 0,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.equal(selected.length, 0);
});

test('batch size is capped so a client cannot request an unbounded feed', () => {
  const { selected } = selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates: makeCandidates(500),
    impressions: new Map(),
    targetCount: 10000,
    now: BASE_TIME,
    rotationBucket: 0,
  });
  assert.equal(selected.length, 50);
});

// ══ Extra discovery features ══════════════════════════════════════════════
//
// Each block below covers one of the twelve feed-quality features layered on
// top of the 7-day rotation.

/** Two candidates that differ only in the field under test. */
function twinsInBucket(bucket, a = {}, b = {}) {
  const base = makeCandidates(1)[0];
  return [
    { ...base, id: idInBucket(VIEWER, 'twinA', bucket), distance: 2000, ...a },
    { ...base, id: idInBucket(VIEWER, 'twinB', bucket), distance: 2000, ...b },
  ];
}

function runBatch(candidates, extra = {}) {
  return selectDiscoveryBatch({
    viewerId: VIEWER,
    candidates,
    impressions: new Map(),
    targetCount: 25,
    now: BASE_TIME,
    rotationBucket: 0,
    ...extra,
  });
}

// ── Feature 12: the 25-profile mix ────────────────────────────────────────

test('feature 12: the default batch reserves the documented 15/5/3/2 mix', () => {
  assert.deepEqual(resolveSlotQuotas(25), {
    fresh: 15,
    recentlyActive: 5,
    exploration: 3,
    newUser: 2,
  });
});

test('feature 12: the mix scales proportionally to any batch size', () => {
  for (const size of [0, 1, 5, 10, 25, 40, 50]) {
    const quotas = resolveSlotQuotas(size);
    const total = Object.values(quotas).reduce((a, b) => a + b, 0);
    assert.equal(total, size, `quotas for ${size} summed to ${total}`);
    assert.ok(Object.values(quotas).every((n) => n >= 0));
  }
});

test('feature 12: an empty category hands its slots to the next-best fresh users', () => {
  // Nobody is new, online, or ranked below the cut, so three of the four
  // categories cannot fill — the batch must still come back full.
  const { selected, diagnostics } = runBatch(makeCandidates(25));

  assert.equal(selected.length, 25);
  assert.equal(diagnostics.slotCounts.newUser, 0, 'no new joiners in this fixture');
  assert.equal(diagnostics.slotCounts.recentlyActive, 0, 'nobody is recently active');
  assert.equal(
    diagnostics.slotCounts.fresh + diagnostics.slotCounts.backfill,
    25 - diagnostics.slotCounts.exploration,
  );
});

// ── Feature 1: fresh drop ─────────────────────────────────────────────────

test('feature 1: reserved fresh slots surface every unseen profile in a mostly-seen pool', () => {
  const candidates = makeCandidates(60);
  const impressions = new Map(
    candidates.slice(0, 50).map((c) => [
      c.id,
      { lastShownAt: new Date(BASE_TIME.getTime() - 10 * DAY_MS), impressionCount: 3 },
    ]),
  );

  const { selected, diagnostics } = runBatch(candidates, { impressions });
  const unseenIds = new Set(idsOf(candidates.slice(50)));
  const servedUnseen = idsOf(selected).filter((id) => unseenIds.has(id));

  assert.equal(selected.length, 25);
  assert.equal(servedUnseen.length, 10, 'an unseen profile was left out of the batch');
  assert.equal(diagnostics.unseenSelected, 10);
  assert.equal(diagnostics.lowSupply, true);
});

// ── Feature 2 & 8: new user boost and injection ───────────────────────────

test('feature 2: new joiners claim their reserved slots even when they rank last', () => {
  const now = new Date(BASE_TIME.getTime());
  // 60 established profiles that all sit in today's rotation bucket, so they
  // occupy the top tier outright and would fill all 25 slots on rank alone.
  const established = idsInBucket(VIEWER, 'estab', 0, 60).map((id) => ({
    ...makeCandidates(1)[0],
    id,
    distance: 100,
  }));
  const newcomers = idsOutsideBucket(VIEWER, 'newbie', 0, 4).map((id) => ({
    ...makeCandidates(1)[0],
    id,
    createdAt: new Date(now.getTime() - DAY_MS),
    // Far away and heavily exposed, so only the reservation can carry them.
    distance: 400000,
    exposureCount: 200,
  }));

  const { selected, diagnostics } = runBatch([...established, ...newcomers], { now });
  const served = selected.filter((u) => u.id.startsWith('newbie-'));

  assert.equal(diagnostics.quotas.newUser, 2);
  assert.equal(diagnostics.slotCounts.newUser, 2);
  assert.equal(served.length, 2, 'new joiners did not get their reserved slots');
  for (const u of served) assert.equal(u.rotationTier, TIER.UNSEEN_NEW_USER);
});

test('feature 8: a brand-new profile enters today without waiting for its bucket day', () => {
  const now = new Date(BASE_TIME.getTime());
  const rotationBucket = rotationBucketForDay(rotationDayKey(now));
  const newcomerId = idOutsideBucket(VIEWER, 'injected', rotationBucket);

  const { tier } = classifyCandidate(
    { ...makeCandidates(1)[0], id: newcomerId, createdAt: now },
    null,
    { now: now.getTime(), rotationBucket, viewerId: VIEWER },
  );
  assert.equal(tier, TIER.UNSEEN_NEW_USER);
  assert.ok(tier < TIER.UNSEEN_OTHER_BUCKET, 'new users must outrank other-bucket unseen');
});

// ── Feature 3: recently active boost ──────────────────────────────────────

test('feature 3: when freshness matches, the online profile ranks first', () => {
  const [idle, online] = twinsInBucket(0, { isOnline: false }, { isOnline: true });
  const { selected } = runBatch([idle, online]);
  assert.equal(selected[0].id, online.id);
});

test('feature 3: recently active users claim reserved slots from further out', () => {
  const near = makeCandidates(40).map((c) => ({ ...c, distance: 200, isOnline: false }));
  const activeFarAway = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    ...makeCandidates(1)[0],
    id: `active-${i}`,
    distance: 300000,
    isOnline: true,
  }));

  const { selected, diagnostics } = runBatch([...near, ...activeFarAway]);
  const served = idsOf(selected).filter((id) => id.startsWith('active-'));

  assert.equal(diagnostics.quotas.recentlyActive, 5);
  assert.ok(served.length >= 5, `only ${served.length} recently-active users reached the batch`);
});

test('feature 3: activity never outranks freshness', () => {
  const onlineButSeen = { ...makeCandidates(1)[0], id: 'online-seen', isOnline: true };
  const offlineFresh = { ...makeCandidates(1)[0], id: 'offline-fresh', isOnline: false };
  const impressions = new Map([
    ['online-seen', { lastShownAt: new Date(BASE_TIME.getTime() - 3600_000), impressionCount: 1 }],
  ]);

  const { selected } = runBatch([onlineButSeen, offlineFresh], { impressions });
  assert.equal(selected[0].id, 'offline-fresh');
});

// ── Feature 4: smart distance mix ─────────────────────────────────────────

test('feature 4: distances are banded, so small gaps no longer decide the order', () => {
  assert.equal(distanceBand(400), distanceBand(950), '400 m and 950 m must share a band');
  assert.notEqual(distanceBand(950), distanceBand(1200));
  assert.ok(distanceBand(2000) < distanceBand(40000));
});

test('feature 4: the batch is not simply the 25 nearest profiles', () => {
  // Nearby profiles that everyone has already been shown a lot, versus fresh
  // faces a little further out. A pure nearest-first feed would ignore the latter.
  const nearSaturated = makeCandidates(30).map((c) => ({
    ...c,
    id: `near-${c.id}`,
    distance: 300,
    exposureCount: 240,
  }));
  const farUnderexposed = makeCandidates(30).map((c) => ({
    ...c,
    id: `far-${c.id}`,
    distance: 40000,
    exposureCount: 0,
    isOnline: true,
  }));

  const { selected, diagnostics } = runBatch([...nearSaturated, ...farUnderexposed]);
  const bands = Object.keys(diagnostics.bandCounts).length;

  assert.equal(selected.length, 25);
  assert.ok(bands >= 2, 'the whole batch came from a single distance band');
  assert.ok(
    idsOf(selected).some((id) => id.startsWith('far-')),
    'no profile outside the nearest cluster made the batch',
  );
});

test('feature 4: distance still decides when nothing else separates two profiles', () => {
  const [far, near] = twinsInBucket(0, { distance: 60000 }, { distance: 300 });
  const { selected } = runBatch([far, near]);
  assert.equal(selected[0].id, near.id);
});

// ── Feature 5: exposure fairness ──────────────────────────────────────────

test('feature 5: an under-exposed profile outranks a saturated one', () => {
  const [popular, quiet] = twinsInBucket(0, { exposureCount: 240 }, { exposureCount: 0 });
  const { selected } = runBatch([popular, quiet]);
  assert.equal(selected[0].id, quiet.id);
});

test('feature 5: fairness credit falls as global exposure rises', () => {
  assert.ok(exposureScore(0, 0) > exposureScore(50, 0));
  assert.ok(exposureScore(50, 0) > exposureScore(240, 0));
  // Saturated profiles stop losing further credit rather than going negative.
  assert.ok(exposureScore(100000, 0) >= 0);
  // A profile this viewer has seen repeatedly also earns less.
  assert.ok(exposureScore(0, 0) > exposureScore(0, 5));
});

test('feature 5: fairness never lets a repeat jump ahead of an unseen profile', () => {
  const seenButUnexposed = { ...makeCandidates(1)[0], id: 'seen-quiet', exposureCount: 0 };
  const unseenButPopular = { ...makeCandidates(1)[0], id: 'fresh-loud', exposureCount: 249 };
  const impressions = new Map([
    ['seen-quiet', { lastShownAt: new Date(BASE_TIME.getTime() - 3600_000), impressionCount: 1 }],
  ]);
  const { selected } = runBatch([seenButUnexposed, unseenButPopular], { impressions });
  assert.equal(selected[0].id, 'fresh-loud');
});

// ── Feature 6: second chance ──────────────────────────────────────────────

test('feature 6: a profile skipped a week ago becomes eligible again', () => {
  const candidate = { ...makeCandidates(1)[0], id: 'skipped' };
  const justInside = new Date(BASE_TIME.getTime() - SECOND_CHANCE_MIN_MS + 60_000);
  const justOutside = new Date(BASE_TIME.getTime() - SECOND_CHANCE_MIN_MS - 60_000);

  const stillCooling = classifyCandidate(candidate, { lastShownAt: justInside }, {
    now: BASE_TIME.getTime(),
    rotationBucket: 0,
    viewerId: VIEWER,
  });
  const eligibleAgain = classifyCandidate(candidate, { lastShownAt: justOutside }, {
    now: BASE_TIME.getTime(),
    rotationBucket: 0,
    viewerId: VIEWER,
  });

  assert.equal(stillCooling.tier, TIER.COOLDOWN_RELAXED);
  assert.equal(eligibleAgain.tier, TIER.COOLDOWN_EXPIRED);
});

test('feature 6: inside the second-chance window, the longest-absent profile returns first', () => {
  const candidates = makeCandidates(4);
  const daysAgo = [8, 29, 14, 21];
  const impressions = new Map(
    candidates.map((c, i) => [
      c.id,
      { lastShownAt: new Date(BASE_TIME.getTime() - daysAgo[i] * DAY_MS), impressionCount: 1 },
    ]),
  );

  const { selected } = runBatch(candidates, { impressions });
  const order = idsOf(selected).map((id) => daysAgo[candidates.findIndex((c) => c.id === id)]);
  assert.deepEqual(order, [29, 21, 14, 8]);
});

test('feature 6: the second-chance window tops out at 30 days', () => {
  assert.equal(SECOND_CHANCE_MIN_MS, 7 * DAY_MS);
  assert.equal(SECOND_CHANCE_MAX_MS, 30 * DAY_MS);
});

// ── Feature 7: mutual relevance ───────────────────────────────────────────

test('feature 7: a profile whose own filters match the viewer ranks higher', () => {
  const [mismatched, matched] = twinsInBucket(
    0,
    { prefs: { gender: 'man', radiusKm: null } },
    { prefs: { gender: 'woman', radiusKm: null } },
  );
  const { selected } = runBatch([mismatched, matched], {
    viewer: { id: VIEWER, gender: 'Woman' },
  });
  assert.equal(selected[0].id, matched.id);
});

test('feature 7: a viewer outside the candidate\'s saved radius scores lower', () => {
  const near = { gender: '', radiusKm: 50 };
  assert.ok(
    mutualRelevanceScore({ prefs: near, distance: 10000 }, { gender: 'Woman' }) >
      mutualRelevanceScore({ prefs: near, distance: 400000 }, { gender: 'Woman' }),
  );
});

test('feature 7: never having saved filters is neutral, not a rejection', () => {
  const unknown = mutualRelevanceScore({ prefs: null, distance: 1000 }, { gender: 'Woman' });
  const rejecting = mutualRelevanceScore(
    { prefs: { gender: 'man', radiusKm: 1 }, distance: 400000 },
    { gender: 'Woman' },
  );
  const accepting = mutualRelevanceScore(
    { prefs: { gender: 'woman', radiusKm: 500 }, distance: 1000 },
    { gender: 'Woman' },
  );
  assert.ok(unknown > rejecting, 'an unsaved preference was treated as a rejection');
  assert.ok(unknown < accepting);
});

test('feature 7: mutual relevance cannot override freshness', () => {
  const seenAndPerfect = {
    ...makeCandidates(1)[0],
    id: 'seen-match',
    prefs: { gender: 'woman', radiusKm: 500 },
  };
  const freshAndMismatched = {
    ...makeCandidates(1)[0],
    id: 'fresh-mismatch',
    prefs: { gender: 'man', radiusKm: 1 },
  };
  const impressions = new Map([
    ['seen-match', { lastShownAt: new Date(BASE_TIME.getTime() - 3600_000), impressionCount: 1 }],
  ]);
  const { selected } = runBatch([seenAndPerfect, freshAndMismatched], {
    impressions,
    viewer: { id: VIEWER, gender: 'Woman' },
  });
  assert.equal(selected[0].id, 'fresh-mismatch');
});

// ── Feature 9: exploration slots ──────────────────────────────────────────

test('feature 9: profiles that would miss the cut still get reserved slots', () => {
  // 24 profiles that dominate on every signal, plus a weaker group that would
  // otherwise contribute exactly one member to a 25-slot batch.
  const strong = makeCandidates(24).map((c) => ({
    ...c,
    id: `strong-${c.id}`,
    distance: 200,
    isOnline: true,
    exposureCount: 0,
  }));
  const weak = makeCandidates(20).map((c) => ({
    ...c,
    id: `weak-${c.id}`,
    distance: 90000,
    isOnline: false,
    exposureCount: 0,
    bio: '',
    interests: [],
  }));

  const { selected, diagnostics } = runBatch([...strong, ...weak]);
  const servedWeak = idsOf(selected).filter((id) => id.startsWith('weak-'));

  assert.equal(selected.length, 25);
  assert.equal(diagnostics.slotCounts.exploration, 3);
  assert.ok(
    servedWeak.length >= 4,
    `exploration did not reach past the natural cut (${servedWeak.length} weak profiles)`,
  );
});

test('feature 9: exploration only considers under-exposed profiles', () => {
  // Exactly enough top-tier profiles to fill the batch, so the only candidates
  // left outside the natural cut are the saturated ones.
  const strong = idsInBucket(VIEWER, 'strong', 0, 25).map((id) => ({
    ...makeCandidates(1)[0],
    id,
    distance: 200,
  }));
  const saturated = idsOutsideBucket(VIEWER, 'sat', 0, 20).map((id) => ({
    ...makeCandidates(1)[0],
    id,
    distance: 90000,
    exposureCount: EXPLORATION_MAX_EXPOSURE + 1,
  }));

  const { selected, diagnostics } = runBatch([...strong, ...saturated]);
  assert.equal(diagnostics.slotCounts.exploration, 0, 'a saturated profile took an exploration slot');
  assert.equal(
    idsOf(selected).filter((id) => id.startsWith('sat-')).length,
    0,
    'a saturated profile displaced an under-exposed one',
  );
});

// ── Feature 11: low supply mode ───────────────────────────────────────────

test('feature 11: a fully-seen pool still returns a full batch and reports low supply', () => {
  const candidates = makeCandidates(40);
  const impressions = new Map(
    candidates.map((c, i) => [
      c.id,
      {
        lastShownAt: new Date(BASE_TIME.getTime() - (i + 1) * DAY_MS),
        impressionCount: 40 - i,
      },
    ]),
  );

  const { selected, diagnostics } = runBatch(candidates, { impressions });

  assert.equal(selected.length, 25, 'Nearby went short instead of recycling');
  assert.equal(diagnostics.lowSupply, true);
  assert.equal(diagnostics.unseenSelected, 0);
  // Recycling starts with whoever has been out of the feed longest.
  assert.equal(selected[0].id, candidates[39].id);
});

test('feature 11: low supply is not reported while the batch is fully fresh', () => {
  const { diagnostics } = runBatch(makeCandidates(60));
  assert.equal(diagnostics.lowSupply, false);
  assert.equal(diagnostics.unseenSelected, 25);
});

// ── Feature 12: the score itself ──────────────────────────────────────────

test('feature 12: score weights are normalised so the score stays comparable', () => {
  const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}`);
  assert.ok(Object.values(SCORE_WEIGHTS).every((w) => w > 0));
});

test('feature 12: every served profile carries its score for debugging', () => {
  const { selected } = runBatch(makeCandidates(30));
  for (const u of selected) {
    assert.equal(typeof u.rotationScore, 'number');
    assert.ok(u.rotationScore >= 0 && u.rotationScore <= 1);
  }
});

test('feature 12: reserved slots never break session memory or introduce duplicates', () => {
  const candidates = makeCandidates(120).map((c, i) => ({
    ...c,
    isOnline: i % 3 === 0,
    exposureCount: (i * 7) % 300,
    createdAt: i % 11 === 0 ? new Date(BASE_TIME.getTime() - DAY_MS) : OLD_ACCOUNT,
  }));

  const store = createImpressionStore();
  const seen = new Set();
  for (let page = 0; page < 4; page += 1) {
    const { selected } = selectDiscoveryBatch({
      viewerId: VIEWER,
      candidates,
      impressions: store.map,
      targetCount: 25,
      now: BASE_TIME,
      rotationBucket: 0,
      excludeIds: [...seen],
    });
    for (const u of selected) {
      assert.ok(!seen.has(u.id), `${u.id} was served twice in one session`);
      seen.add(u.id);
    }
  }
  assert.equal(seen.size, 100);
});
