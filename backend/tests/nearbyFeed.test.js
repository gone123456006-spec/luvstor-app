const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  NEARBY_HARD_RADIUS_M,
  NEARBY_MAX_RESPONSE,
  publicNearbyDistance,
  splitWithinHardRadius,
  takeNearbySection,
  takeWiderSection,
  assembleMixedFeed,
  discoveryRecencyTier,
  takeDiscoverySection,
  discoveryJitter,
  rotationGroup,
  poolCompletedCycle,
  readNearbyCycle,
} = require('../services/discovery');

function doc(id, lng, lat) {
  return { _id: id, location: { type: 'Point', coordinates: [lng, lat] } };
}

// ~1 km north of Bangalore-ish origin
const ORIGIN = { lng: 77.5946, lat: 12.9716 };

describe('Nearby 1–25 / 26–50 assembly', () => {
  test('core nearby stays closest-first and inside 100 km', () => {
    const docs = [
      doc('a', ORIGIN.lng, ORIGIN.lat + 0.01), // ~1 km
      doc('b', ORIGIN.lng, ORIGIN.lat + 0.05), // ~5 km
      doc('c', ORIGIN.lng, ORIGIN.lat + 0.8), // ~89 km
      doc('d', ORIGIN.lng, ORIGIN.lat + 2), // ~222 km — dropped
    ];
    const { core, rest } = splitWithinHardRadius(docs, {
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      coreMaxM: 10_000,
    });
    assert.deepEqual(core.map((x) => String(x.doc._id)), ['a', 'b']);
    assert.deepEqual(rest.map((x) => String(x.doc._id)), ['c']);
    assert.ok(core.every((x) => x.distance <= 10_000));
    assert.ok(rest.every((x) => x.distance <= NEARBY_HARD_RADIUS_M));
  });

  test('fills 1–25 from leftover 100 km users when core is short', () => {
    const core = [
      { doc: doc('1', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 800 },
    ];
    const rest = Array.from({ length: 20 }, (_, i) => ({
      doc: doc(`r${i}`, ORIGIN.lng, ORIGIN.lat),
      source: 'nearby',
      distance: 20_000 + i,
    }));
    const section = takeNearbySection(core, rest, 25);
    assert.equal(section[0].doc._id, '1');
    assert.equal(section.length, 21);
    assert.ok(section.every((x) => x.source === 'nearby'));
    const ids = section.map((x) => String(x.doc._id));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('never pulls outside 100 km to complete 1–25', () => {
    const core = [{ doc: doc('1', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 500 }];
    const section = takeNearbySection(core, [], 25);
    assert.equal(section.length, 1);
  });

  test('wider section excludes selected ids and people still inside 100 km', () => {
    const selected = new Set(['keep']);
    const docs = [
      doc('keep', ORIGIN.lng + 3, ORIGIN.lat),
      doc('inside', ORIGIN.lng, ORIGIN.lat + 0.2),
      doc('far1', ORIGIN.lng + 3, ORIGIN.lat),
      doc('far2', ORIGIN.lng + 3.1, ORIGIN.lat),
    ];
    const wider = takeWiderSection(docs, selected, {
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      size: 25,
    });
    const ids = wider.map((x) => String(x.doc._id));
    assert.ok(!ids.includes('keep'));
    assert.ok(!ids.includes('inside'));
    assert.ok(ids.includes('far1') || ids.includes('far2'));
    assert.ok(wider.every((x) => x.source === 'random'));
    assert.ok(wider.length <= 25);
  });

  test('combined response never exceeds 50 or duplicates', () => {
    const core = Array.from({ length: 30 }, (_, i) => ({
      doc: doc(`n${i}`, ORIGIN.lng, ORIGIN.lat),
      source: 'nearby',
      distance: 1000 + i,
    }));
    const nearby = takeNearbySection(core, [], 25);
    const widerDocs = Array.from({ length: 40 }, (_, i) =>
      doc(`w${i}`, ORIGIN.lng + 3, ORIGIN.lat),
    );
    const wider = takeWiderSection(widerDocs, new Set(nearby.map((x) => String(x.doc._id))), {
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      size: 25,
    });
    const all = [...nearby, ...wider];
    assert.ok(all.length <= NEARBY_MAX_RESPONSE);
    assert.equal(nearby.length, 25);
    assert.equal(wider.length, 25);
    const ids = all.map((x) => String(x.doc._id));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('mix never puts people outside 100 km into 1–25', () => {
    const nearby = Array.from({ length: 10 }, (_, i) => ({
      doc: doc(`n${i}`, ORIGIN.lng, ORIGIN.lat),
      source: 'nearby',
      distance: 1000 + i,
    }));
    const wider = Array.from({ length: 40 }, (_, i) => ({
      doc: doc(`w${i}`, ORIGIN.lng + 3, ORIGIN.lat),
      source: 'random',
      distance: 300_000,
    }));
    const mixed = assembleMixedFeed(nearby, wider);
    assert.equal(mixed.length, 35);
    assert.ok(mixed.slice(0, 10).every((x) => x.source === 'nearby'));
    assert.ok(mixed.slice(10).every((x) => x.source === 'random'));
    const ids = mixed.map((x) => String(x.doc._id));
    assert.equal(new Set(ids).size, 35);
  });

  test('fresh users are closest-first, then already-shown', () => {
    const now = new Date('2026-09-23T10:00:00.000Z');
    const items = [
      { doc: doc('fresh-far', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 9000 },
      { doc: doc('seen-close', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 400 },
      { doc: doc('fresh-close', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 600 },
    ];
    const impressions = new Map([
      ['seen-close', { lastShownAt: new Date('2026-09-23T08:00:00.000Z') }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      now,
      size: 25,
    });
    const ids = picked.map((x) => String(x.doc._id));
    assert.deepEqual(ids, ['fresh-close', 'fresh-far', 'seen-close']);
  });

  test('discovery ranks never-shown people ahead of someone shown today', () => {
    const now = new Date('2026-09-23T10:00:00.000Z');
    const items = [
      { doc: doc('seen-today', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 500 },
      { doc: doc('fresh-1', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 8000 },
      { doc: doc('fresh-2', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 9000 },
    ];
    const impressions = new Map([
      ['seen-today', { lastShownAt: new Date('2026-09-23T08:00:00.000Z') }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      now,
      size: 25,
    });
    const ids = picked.map((x) => String(x.doc._id));
    assert.ok(ids.indexOf('fresh-1') < ids.indexOf('seen-today'));
    assert.ok(ids.indexOf('fresh-2') < ids.indexOf('seen-today'));
    assert.equal(ids[2], 'seen-today');
    assert.equal(discoveryRecencyTier(Date.parse('2026-09-23T08:00:00.000Z'), now.getTime()), 3);
    assert.equal(discoveryRecencyTier(0, now.getTime()), 0);
  });

  test('after unseen people, oldest lastShownAt is filled before a recent one', () => {
    const now = new Date('2026-09-23T10:00:00.000Z');
    const items = [
      { doc: doc('recent', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 1000 },
      { doc: doc('oldest', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 8000 },
    ];
    const impressions = new Map([
      ['recent', { lastShownAt: new Date('2026-09-22T10:00:00.000Z'), lastSource: 'nearby' }],
      ['oldest', { lastShownAt: new Date('2026-09-01T10:00:00.000Z'), lastSource: 'nearby' }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      now,
      size: 25,
    });
    assert.equal(String(picked[0].doc._id), 'oldest');
    assert.equal(String(picked[1].doc._id), 'recent');
  });

  test('26–50 random impressions do not affect Nearby rotation', () => {
    const now = new Date('2026-09-23T10:00:00.000Z');
    const items = [
      { doc: doc('only-random', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 1000 },
      { doc: doc('fresh', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 2000 },
    ];
    const impressions = new Map([
      ['only-random', { lastShownAt: new Date('2026-09-23T09:00:00.000Z'), lastSource: 'random' }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      now,
      size: 25,
    });
    const ids = picked.map((x) => String(x.doc._id));
    assert.equal(ids.length, 2);
    assert.ok(ids.includes('only-random'));
    assert.ok(ids.includes('fresh'));
  });

  test('discovery fills with previously shown 100 km users when fresh supply is short', () => {
    const now = new Date('2026-09-23T10:00:00.000Z');
    const items = [
      { doc: doc('fresh', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 2000 },
      { doc: doc('old', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 3000 },
    ];
    const impressions = new Map([
      ['old', { lastShownAt: new Date('2026-09-23T09:00:00.000Z') }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      now,
      size: 25,
    });
    assert.equal(picked.length, 2);
    assert.equal(picked[0].doc._id, 'fresh');
    assert.equal(picked[1].doc._id, 'old');
  });

  test('never-shown and new 100 km users outrank the current cycle', () => {
    const items = [
      { doc: doc('this-cycle', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 400 },
      { doc: doc('prev-cycle', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 500 },
      { doc: doc('brand-new', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 9000 },
    ];
    const impressions = new Map([
      ['this-cycle', {
        lastShownAt: new Date('2026-09-01T10:00:00.000Z'),
        lastSource: 'nearby',
        nearbyCycle: 3,
      }],
      ['prev-cycle', {
        lastShownAt: new Date('2026-08-01T10:00:00.000Z'),
        lastSource: 'nearby',
        nearbyCycle: 2,
      }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      cycle: 3,
      size: 25,
    });
    assert.deepEqual(picked.map((x) => String(x.doc._id)), [
      'brand-new',
      'prev-cycle',
      'this-cycle',
    ]);
    assert.equal(rotationGroup(impressions.get('brand-new'), 3), 0);
    assert.equal(rotationGroup(impressions.get('prev-cycle'), 3), 1);
    assert.equal(rotationGroup(impressions.get('this-cycle'), 3), 2);
  });

  test('starts a new cycle only after every current 100 km candidate was shown', () => {
    const items = [
      { doc: doc('a', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 1000 },
      { doc: doc('b', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 2000 },
    ];
    const complete = new Map([
      ['a', { lastShownAt: new Date('2026-09-23T08:00:00.000Z'), lastSource: 'nearby', nearbyCycle: 4 }],
      ['b', { lastShownAt: new Date('2026-09-23T09:00:00.000Z'), lastSource: 'nearby', nearbyCycle: 4 }],
    ]);
    const incomplete = new Map(complete);
    incomplete.delete('b');
    assert.equal(poolCompletedCycle(items, complete, 4), true);
    assert.equal(poolCompletedCycle(items, incomplete, 4), false);
    assert.equal(poolCompletedCycle(items, complete, 5), false);
    assert.equal(poolCompletedCycle([], complete, 4), false);
    assert.equal(readNearbyCycle({ discoveryPrefs: { nearbyCycle: 4 } }), 4);
    assert.equal(readNearbyCycle({}), 1);
  });

  test('new cycle uses a different jitter so the feed is not identical', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      doc: doc(`u${i}`, ORIGIN.lng, ORIGIN.lat),
      source: 'nearby',
      distance: 1000 + i,
    }));
    const shownAt = new Date('2026-09-20T10:00:00.000Z');
    const impressions = new Map(
      items.map((item) => [
        String(item.doc._id),
        { lastShownAt: shownAt, lastSource: 'nearby', nearbyCycle: 1 },
      ]),
    );
    assert.notEqual(
      discoveryJitter('viewer-cycle', 'u0', 2),
      discoveryJitter('viewer-cycle', 'u0', 3),
    );
    const order1 = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-cycle',
      cycle: 2,
      reshuffle: true,
      size: 25,
    }).map((x) => String(x.doc._id));
    const order2 = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-cycle',
      cycle: 3,
      reshuffle: true,
      size: 25,
    }).map((x) => String(x.doc._id));
    assert.equal(new Set(order1).size, 12);
    assert.equal(new Set(order2).size, 12);
    assert.notDeepEqual(order1, order2);
  });

  test('small 100 km pools may repeat previously shown users without duplicates', () => {
    const items = [
      { doc: doc('fresh', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 1000 },
      { doc: doc('old', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 2000 },
    ];
    const impressions = new Map([
      ['old', {
        lastShownAt: new Date('2026-09-23T09:00:00.000Z'),
        lastSource: 'nearby',
        nearbyCycle: 2,
      }],
    ]);
    const picked = takeDiscoverySection(items, impressions, {
      viewerId: 'viewer-1',
      cycle: 2,
      size: 25,
    });
    const ids = picked.map((x) => String(x.doc._id));
    assert.deepEqual(ids, ['fresh', 'old']);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('short 100 km lists still fill toward 50 with random people', () => {
    const nearby = [{ doc: doc('n1', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 800 }];
    const wider = Array.from({ length: 60 }, (_, i) => ({
      doc: doc(`w${i}`, ORIGIN.lng + 3, ORIGIN.lat),
      source: 'random',
      distance: 300_000,
    }));
    const mixed = assembleMixedFeed(nearby, wider, { widerSize: 49, max: 50 });
    assert.equal(mixed.length, 50);
    assert.equal(mixed[0].source, 'nearby');
    assert.ok(mixed.slice(1).every((x) => x.source === 'random'));
    assert.equal(new Set(mixed.map((x) => String(x.doc._id))).size, 50);
  });

  test('public km is 1–100 for Nearby and hidden for random', () => {
    assert.deepEqual(publicNearbyDistance(0, 'nearby'), {
      distanceKm: '1',
      distanceM: 0,
    });
    assert.deepEqual(publicNearbyDistance(80, 'nearby'), {
      distanceKm: '1',
      distanceM: 80,
    });
    assert.deepEqual(publicNearbyDistance(100, 'nearby'), {
      distanceKm: '1',
      distanceM: 100,
    });
    assert.deepEqual(publicNearbyDistance(400, 'nearby'), {
      distanceKm: '0.4',
      distanceM: 400,
    });
    assert.deepEqual(publicNearbyDistance(12_400, 'nearby'), {
      distanceKm: '12.4',
      distanceM: 12400,
    });
    assert.deepEqual(publicNearbyDistance(99_960, 'nearby'), {
      distanceKm: '100',
      distanceM: 99960,
    });
    assert.deepEqual(publicNearbyDistance(124_449, 'nearby'), {
      distanceKm: null,
      distanceM: null,
    });
    assert.deepEqual(publicNearbyDistance(80_000, 'random'), {
      distanceKm: '80',
      distanceM: 80000,
    });
    assert.deepEqual(publicNearbyDistance(124_449_700, 'random'), {
      distanceKm: null,
      distanceM: null,
    });
    assert.deepEqual(publicNearbyDistance(300_000, 'random'), {
      distanceKm: null,
      distanceM: null,
    });
  });

  test('mix does not invent users when the global pool is small', () => {
    const nearby = [{ doc: doc('n1', ORIGIN.lng, ORIGIN.lat), source: 'nearby', distance: 800 }];
    const wider = [
      { doc: doc('w1', ORIGIN.lng + 3, ORIGIN.lat), source: 'random', distance: 300_000 },
      { doc: doc('w2', ORIGIN.lng + 3.1, ORIGIN.lat), source: 'random', distance: 310_000 },
    ];
    const mixed = assembleMixedFeed(nearby, wider);
    assert.equal(mixed.length, 3);
    assert.equal(mixed[0].source, 'nearby');
    assert.ok(mixed.slice(1).every((x) => x.source === 'random'));
  });
});
