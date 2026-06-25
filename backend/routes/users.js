const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// ─────────────────────────────────────────────
// GET /api/users/me  — get my profile
// ─────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-__v');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/me  — update my profile
// ─────────────────────────────────────────────
router.put('/me', auth, async (req, res) => {
  try {
    const allowed = ['name', 'age', 'bio', 'gender', 'interests', 'relationshipGoal',
                     'photo', 'height', 'distance', 'tokenBalance', 'lastSpinDate'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      returnDocument: 'after',
    }).select('-__v');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/location  — update my location (lat/lng)
// ─────────────────────────────────────────────
router.put('/location', auth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }
    await User.findByIdAndUpdate(req.userId, {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude], // GeoJSON is [lng, lat]
      },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/nearby?radius=50000  — get nearby users
// radius is in metres, default 50 km
// ─────────────────────────────────────────────
router.get('/nearby', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ error: 'User not found' });

    const [lng, lat] = me.location.coordinates;
    const radiusMetres = parseInt(req.query.radius) || 50000; // 50 km default

    const nearby = await User.find({
      _id: { $ne: me._id },
      isVerified: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusMetres,
        },
      },
    })
      .select('name age bio photo gender interests isOnline lastSeen location')
      .limit(50);

    // Calculate distance for each user and add to response
    const results = nearby.map(u => {
      const [uLng, uLat] = u.location.coordinates;
      const distM = getDistanceMetres(lat, lng, uLat, uLng);
      return {
        id: u._id,
        name: u.name,
        age: u.age,
        bio: u.bio,
        photo: u.photo,
        gender: u.gender,
        interests: u.interests,
        isOnline: u.isOnline,
        distanceKm: (distM / 1000).toFixed(1),
      };
    });

    res.json(results);
  } catch (err) {
    console.error('nearby error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// Haversine formula helper
// ─────────────────────────────────────────────
function getDistanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = router;
