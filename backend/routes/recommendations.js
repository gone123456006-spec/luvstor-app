const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { buildForYouBatch } = require('../services/forYou');
const { syncExpiredSubscription } = require('../services/subscriptions');
const { readLimiter } = require('../middleware/rateLimit');
const { redisRateLimit } = require('../utils/scaleHelpers');

const forYouRedisGuard = redisRateLimit({
  prefix: 'foryou',
  windowMs: 60 * 1000,
  max: 60,
});

/**
 * GET /api/recommendations/for-you
 * Discover "For you" tab — does not change Nearby.
 *
 * Query: page, count, forceRefresh=1
 * Pagination is cache-backed (Redis when available) for multi-million scale.
 */
router.get('/for-you', auth, forYouRedisGuard, readLimiter, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    const viewer = await User.findById(req.userId).select(
      'location distance interests gender showMe discoveryPrefs subscriptionPlan subscriptionExpiresAt',
    );
    if (!viewer) return res.status(404).json({ error: 'User not found' });

    const page = Math.max(1, Number(req.query.page) || 1);
    const count = Math.min(40, Math.max(1, Number(req.query.count) || 25));
    const forceRefresh = String(req.query.forceRefresh || '') === '1';
    // excludeIds optional — prefer page-only paging with Redis cache
    const excludeIds = String(req.query.excludeIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);

    const result = await buildForYouBatch({
      viewer,
      page,
      count,
      excludeIds,
      forceRefresh,
    });

    if (result.reason === 'LOCATION_REQUIRED') {
      return res.status(400).json({
        error: 'Location required for For You suggestions',
        code: 'LOCATION_REQUIRED',
        users: [],
        hasMore: false,
      });
    }

    res.setHeader('X-ForYou-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.json({
      users: result.users,
      hasMore: result.hasMore,
      pagination: result.pagination,
      feed: 'for_you',
      cacheHit: !!result.cacheHit,
    });
  } catch (err) {
    console.error('recommendations/for-you error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
