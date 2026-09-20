const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Friendship = require("../models/Friendship");
const auth = require("../middleware/auth");
const { ensureUserPublicId } = require("../utils/publicId");
const { applyBlockPrivacy, isEitherBlocked } = require("../utils/blockPrivacy");
const {
  serializeSubscription,
  ensureDiscoverTopSpot,
  syncExpiredSubscription,
} = require("../services/subscriptions");
const { buildNearbyBatch, hasRealLocation } = require("../services/discovery");
const { recordProfileView } = require("../services/profileViews");
const {
  canonicalShowMe,
  resolveShowMe,
  followGenderChange,
  toGenderFilter,
} = require("../utils/showMe");
const {
  DEFAULT_TARGET_COUNT,
  MAX_TARGET_COUNT,
  MAX_SESSION_EXCLUDE,
} = require("../services/discoveryRotation");
const { MAX_PROFILE_PHOTOS } = require("../config/profileLimits");
const { isProfileComplete } = require("../utils/userHelpers");
const { WELCOME_PROFILE_TOKENS, GALLERY_POST_TOKENS_PER_IMAGE } = require("../services/chatTokens");
const {
  toPersistentMediaUrl,
  sanitizeProfileMediaUpdate,
  sanitizePhotosArray,
} = require("../utils/mediaUrl");

/** Normalize owner media for API responses; heal bad Mongo values in the background. */
function shapeOwnerMediaFields(user) {
  const photo = toPersistentMediaUrl(user.photo);
  const coverPhoto = toPersistentMediaUrl(user.coverPhoto);
  const photos = sanitizePhotosArray(user.photos || [], MAX_PROFILE_PHOTOS);
  const prevPhoto = String(user.photo || "");
  const prevCover = String(user.coverPhoto || "");
  const prevPhotos = Array.isArray(user.photos)
    ? user.photos.map((p) => String(p || "")).filter(Boolean)
    : [];
  const photosChanged =
    photos.length !== prevPhotos.length ||
    photos.some((p, i) => p !== toPersistentMediaUrl(prevPhotos[i]));
  if (photo !== prevPhoto || coverPhoto !== prevCover || photosChanged) {
    User.updateOne(
      { _id: user._id },
      { $set: { photo, coverPhoto, photos } },
    ).catch((err) =>
      console.warn("media URL heal failed:", err.message),
    );
  }
  return { photo, coverPhoto, photos };
}

/**
 * Profile Isolation Principles:
 * 1. Users can ONLY access their own FULL profile (GET /me)
 * 2. Users can ONLY modify their own profile (PUT /me)
 * 3. Location updates are isolated per user
 * 4. No endpoint exists to access other users' private profiles
 * 5. Nearby users only see limited, discovery-oriented fields
 * 6. No direct user lookup by ID (prevents profile enumeration)
 */

// ─────────────────────────────────────────────
// GET /api/users/me  — get MY COMPLETE PROFILE (private, full access)
// Only the authenticated user can access their complete profile
// ─────────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    await syncExpiredSubscription(req.userId);
    // Ownership check: can only get own profile
    const user = await User.findById(req.userId).select("-__v -activeDeviceId");
    if (!user) return res.status(404).json({ error: "User not found" });

    // Backfill unique public ID for older accounts
    await ensureUserPublicId(user);

    const media = shapeOwnerMediaFields(user);

    // Return COMPLETE profile data (only to owner)
    res.json({
      id: user._id,
      publicId: user.publicId || "",
      email: user.email,
      name: user.name,
      authProvider: user.authProvider || "email",
      age: user.age,
      bio: user.bio,
      gender: user.gender,
      showMe: resolveShowMe(user),
      interests: user.interests,
      relationshipGoal: user.relationshipGoal,
      photo: media.photo,
      coverPhoto: media.coverPhoto || "",
      photos: media.photos,
      height: user.height,
      distance: user.distance,
      location: user.location,
      isVerified: user.isVerified,
      photoVerification: {
        status: user.photoVerification?.status || "none",
        photoVerified: user.photoVerification?.status === "approved",
        submittedAt: user.photoVerification?.submittedAt || null,
        reviewedAt: user.photoVerification?.reviewedAt || null,
        reviewNote: user.photoVerification?.reviewNote || "",
      },
      openStreakDays: Number(user.openStreakDays) || 0,
      tokenBalance: user.tokenBalance,
      lastSpinDate: user.lastSpinDate,
      chatSessionStartedAt: user.chatSessionStartedAt,
      chatSessionExpiresAt: user.chatSessionExpiresAt,
      subscription: serializeSubscription(user),
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      // Lets the app restore the Discover filters the user last browsed with.
      discoveryPrefs: {
        gender: user.discoveryPrefs?.gender || "",
        radiusKm: user.discoveryPrefs?.radiusKm ?? null,
        activeWithinMinutes: user.discoveryPrefs?.activeWithinMinutes || 0,
      },
      explorePrefs: {
        showMe: canonicalShowMe(user.explorePrefs?.showMe) || "All",
        verifiedOnly: !!user.explorePrefs?.verifiedOnly,
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    console.error("GET /me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/me  — update MY PROFILE (only me, protected fields blocked)
// ─────────────────────────────────────────────
// Allowed fields: profile data only. NO tokenBalance, lastSpinDate (server-only).
router.put("/me", auth, async (req, res) => {
  try {
    // Ownership check: can only update own profile
    if (req.body.userId !== undefined || req.params.userId) {
      return res.status(400).json({ error: "Cannot specify user ID" });
    }

    // User-writable fields only (NOT gamification or session data)
    const allowed = [
      "name",
      "age",
      "bio",
      "gender",
      "showMe",
      "interests",
      "relationshipGoal",
      "photo",
      "coverPhoto",
      "photos",
      "height",
      "distance",
    ];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    // Never persist file:// / content:// / LAN absolutes — they blank after reinstall
    if (updates.photo !== undefined) {
      const next = sanitizeProfileMediaUpdate(updates.photo);
      if (next === undefined) {
        delete updates.photo; // invalid device URI — keep existing DB photo
      } else {
        updates.photo = next;
      }
    }

    if (updates.coverPhoto !== undefined) {
      const next = sanitizeProfileMediaUpdate(
        typeof updates.coverPhoto === "string" ? updates.coverPhoto : "",
      );
      if (next === undefined) {
        delete updates.coverPhoto;
      } else {
        updates.coverPhoto = next;
      }
    }

    // Gallery: max 6 images, persistent URLs only
    if (updates.photos !== undefined) {
      if (!Array.isArray(updates.photos)) {
        return res.status(400).json({ error: "photos must be an array" });
      }
      updates.photos = sanitizePhotosArray(updates.photos, MAX_PROFILE_PHOTOS);
    }

    if (
      updates.age !== undefined &&
      updates.age !== null &&
      updates.age !== ""
    ) {
      updates.age = Number(updates.age);
      if (
        !Number.isFinite(updates.age) ||
        updates.age < 18 ||
        updates.age > 100
      ) {
        return res
          .status(400)
          .json({ error: "age must be between 18 and 100" });
      }
    }

    if (updates.height !== undefined) {
      if (updates.height === null || updates.height === "") {
        updates.height = null;
      } else {
        updates.height = Number(updates.height);
        if (
          !Number.isFinite(updates.height) ||
          updates.height < 100 ||
          updates.height > 250
        ) {
          return res
            .status(400)
            .json({ error: "height must be between 100 and 250 cm" });
        }
      }
    }

    if (updates.distance !== undefined) {
      updates.distance = Number(updates.distance);
      if (
        !Number.isFinite(updates.distance) ||
        updates.distance < 1 ||
        updates.distance > 500
      ) {
        return res
          .status(400)
          .json({ error: "distance must be between 1 and 500 km" });
      }
    }

    if (updates.interests !== undefined) {
      if (!Array.isArray(updates.interests)) {
        return res.status(400).json({ error: "interests must be an array" });
      }
      updates.interests = updates.interests
        .filter((i) => typeof i === "string" && i.trim())
        .map((i) => String(i).trim())
        .slice(0, 20);
    }

    if (updates.gender !== undefined) {
      updates.gender = String(updates.gender || "").trim();
    }

    if (updates.showMe !== undefined) {
      const canonical = canonicalShowMe(updates.showMe);
      if (String(updates.showMe || "").trim() && !canonical) {
        return res
          .status(400)
          .json({ error: "showMe must be Man, Woman, Other, or All" });
      }
      updates.showMe = canonical;
    }

    if (updates.showMe || updates.gender !== undefined) {
      const current = await User.findById(req.userId)
        .select("gender showMe")
        .lean();
      if (!current) return res.status(404).json({ error: "User not found" });

      if (updates.showMe) {
        updates["discoveryPrefs.gender"] = updates.showMe;
        updates["discoveryPrefs.updatedAt"] = new Date();
      } else if (
        updates.gender !== undefined &&
        req.body.showMe === undefined
      ) {
        const nextShowMe = followGenderChange(
          current.gender,
          current.showMe,
          updates.gender,
        );
        updates.showMe = nextShowMe;
        updates["discoveryPrefs.gender"] = nextShowMe;
        updates["discoveryPrefs.updatedAt"] = new Date();
      }
    }

    if (updates.relationshipGoal !== undefined) {
      updates.relationshipGoal = String(updates.relationshipGoal || "").trim();
    }

    // Explore match preferences (independent from Discover showMe)
    if (req.body.explorePrefs && typeof req.body.explorePrefs === "object") {
      const ep = req.body.explorePrefs;
      if (ep.showMe !== undefined) {
        const canonical = canonicalShowMe(ep.showMe);
        if (String(ep.showMe || "").trim() && !canonical) {
          return res.status(400).json({
            error: "explorePrefs.showMe must be Man, Woman, Other, or All",
          });
        }
        updates["explorePrefs.showMe"] = canonical || "All";
      }
      if (ep.verifiedOnly !== undefined) {
        updates["explorePrefs.verifiedOnly"] = !!ep.verifiedOnly;
      }
      updates["explorePrefs.updatedAt"] = new Date();
    }

    // Validate no attempt to modify protected fields (security critical)
    const protectedFields = [
      "tokenBalance",
      "welcomeTokensGrantedAt",
      "photoVerificationTokensGrantedAt",
      "galleryPostRewardCount",
      "galleryPostRewardInitialized",
      "tokenPack10PurchaseCount",
      "lastTokenPaymentId",
      "lastSpinDate",
      "activeDeviceId",
      "chatSessionStartedAt",
      "chatSessionExpiresAt",
      "isVerified",
      "isOnline",
      "email",
      "location",
      "userId",
      "_id",
      "publicId",
      "photoVerification",
      "openStreakDays",
      "lastOpenDate",
    ];
    for (const field of protectedFields) {
      if (req.body[field] !== undefined) {
        return res.status(403).json({
          error: `Cannot modify protected field: ${field}`,
          code: "FORBIDDEN_FIELD",
        });
      }
    }

    const before = await User.findById(req.userId)
      .select(
        "name age bio gender photo photos interests relationshipGoal welcomeTokensGrantedAt tokenBalance photoVerification galleryPostRewardCount galleryPostRewardInitialized",
      )
      .lean();
    if (!before) return res.status(404).json({ error: "User not found" });
    const wasComplete = isProfileComplete(before);

    // Update only own profile by userId
    let user = await User.findByIdAndUpdate(req.userId, updates, {
      returnDocument: "after",
      runValidators: true,
    }).select("-__v -activeDeviceId");

    if (!user) return res.status(404).json({ error: "User not found" });
    await ensureUserPublicId(user);

    // Re-verify if main profile photo changed a lot after photo verification
    const photoChanged =
      updates.photo !== undefined || updates.photos !== undefined;
    if (
      photoChanged &&
      before.photoVerification?.status === "approved"
    ) {
      const { mainPhotoFingerprint } = require("../services/photoFaceMatch");
      const prevFp =
        before.photoVerification.verifiedMainPhoto ||
        mainPhotoFingerprint(before);
      const nextFp = mainPhotoFingerprint(user);
      if (prevFp && nextFp && prevFp !== nextFp) {
        user = await User.findByIdAndUpdate(
          req.userId,
          {
            $set: {
              "photoVerification.status": "none",
              "photoVerification.reviewedAt": new Date(),
              "photoVerification.reviewNote":
                "Re-verify required after changing your main photo",
              "photoVerification.verifiedMainPhoto": "",
              "photoVerification.matchScore": null,
            },
          },
          { returnDocument: "after" },
        ).select("-__v -activeDeviceId");
      }
    }

    // One-time welcome tokens: only when profile becomes complete the first time
    let welcomeTokensGranted = 0;
    let galleryPostTokensGranted = 0;
    if (
      !wasComplete &&
      isProfileComplete(user) &&
      !before.welcomeTokensGrantedAt
    ) {
      const granted = await User.findOneAndUpdate(
        {
          _id: req.userId,
          $or: [
            { welcomeTokensGrantedAt: null },
            { welcomeTokensGrantedAt: { $exists: false } },
          ],
        },
        {
          $inc: { tokenBalance: WELCOME_PROFILE_TOKENS },
          $set: { welcomeTokensGrantedAt: new Date() },
        },
        { returnDocument: "after" },
      ).select("tokenBalance welcomeTokensGrantedAt");

      if (granted) {
        welcomeTokensGranted = WELCOME_PROFILE_TOKENS;
        user.tokenBalance = granted.tokenBalance;
        user.welcomeTokensGrantedAt = granted.welcomeTokensGrantedAt;
        try {
          const { createNotification } = require("../services/notifications");
          await createNotification(req.app.get("io"), {
            userId: req.userId,
            type: "token",
            title: "Welcome bonus!",
            body: `You received ${WELCOME_PROFILE_TOKENS} free tokens for completing your profile.`,
            deepLink: "/(tabs)/token",
            data: {
              screen: "token",
              code: "WELCOME_BONUS",
              amount: WELCOME_PROFILE_TOKENS,
            },
          });
        } catch (e) {
          console.warn("welcome token notification failed", e?.message || e);
        }
      }
    }

    // Post gallery: +5 tokens per image, first add only (new users / empty gallery)
    if (updates.photos !== undefined) {
      const beforePhotos = Array.isArray(before.photos)
        ? before.photos.filter((u) => String(u || "").trim())
        : [];
      const afterPhotos = Array.isArray(user.photos)
        ? user.photos.filter((u) => String(u || "").trim())
        : [];
      const nextCount = Math.min(afterPhotos.length, MAX_PROFILE_PHOTOS);

      let rewardCount = Number(before.galleryPostRewardCount) || 0;
      let initialized = !!before.galleryPostRewardInitialized;

      if (!initialized) {
        // Existing users who already have posts: lock out (no free tokens)
        if (beforePhotos.length > 0) {
          rewardCount = MAX_PROFILE_PHOTOS;
        } else {
          rewardCount = 0;
        }
        initialized = true;
        await User.findByIdAndUpdate(req.userId, {
          $set: {
            galleryPostRewardInitialized: true,
            galleryPostRewardCount: rewardCount,
          },
        });
      }

      const slotsToReward = Math.max(0, nextCount - rewardCount);
      if (slotsToReward > 0 && rewardCount < MAX_PROFILE_PHOTOS) {
        const grantSlots = Math.min(
          slotsToReward,
          MAX_PROFILE_PHOTOS - rewardCount,
        );
        const grantTokens = grantSlots * GALLERY_POST_TOKENS_PER_IMAGE;
        const granted = await User.findOneAndUpdate(
          {
            _id: req.userId,
            galleryPostRewardCount: { $lt: MAX_PROFILE_PHOTOS },
          },
          {
            $inc: {
              tokenBalance: grantTokens,
              galleryPostRewardCount: grantSlots,
            },
            $set: { galleryPostRewardInitialized: true },
          },
          { returnDocument: "after" },
        ).select("tokenBalance galleryPostRewardCount");

        if (granted) {
          galleryPostTokensGranted = grantTokens;
          user.tokenBalance = granted.tokenBalance;
          try {
            const { createNotification } = require("../services/notifications");
            await createNotification(req.app.get("io"), {
              userId: req.userId,
              type: "token",
              title: "Post photo bonus!",
              body: `You received ${galleryPostTokensGranted} tokens for adding ${grantSlots} post photo${grantSlots > 1 ? "s" : ""}.`,
              deepLink: "/(tabs)/token",
              data: {
                screen: "token",
                code: "GALLERY_POST_BONUS",
                amount: galleryPostTokensGranted,
                images: grantSlots,
              },
            });
          } catch (e) {
            console.warn("gallery post token notification failed", e?.message || e);
          }
        }
      }
    }

    // Instantly sync profile changes across Discover, Chat, etc.
    const publicFieldsChanged = [
      "name",
      "bio",
      "photo",
      "coverPhoto",
      "photos",
      "age",
      "gender",
      "height",
      "interests",
      "relationshipGoal",
    ].some((f) => updates[f] !== undefined);
    if (publicFieldsChanged) {
      try {
        const { emitProfileUpdate } = require("../utils/realtime");
        emitProfileUpdate(req.app.get("io"), user);
      } catch (e) {
        console.warn("emitProfileUpdate failed", e?.message || e);
      }
    }

    res.json({
      message: "Profile updated",
      profile: user,
      publicId: user.publicId || "",
      welcomeTokensGranted,
      galleryPostTokensGranted,
      tokenBalance: user.tokenBalance ?? 0,
    });
  } catch (err) {
    console.error("PUT /me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/location  — update MY LOCATION ONLY (lat/lng)
// ─────────────────────────────────────────────
router.put("/location", auth, async (req, res) => {
  try {
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res
        .status(400)
        .json({ error: "latitude and longitude are required" });
    }
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }
    // Reject null-island so Discover never treats [0,0] as a real place
    if (latitude === 0 && longitude === 0) {
      return res
        .status(400)
        .json({ error: "Could not read a valid GPS fix. Try again." });
    }

    const updated = await User.findByIdAndUpdate(
      req.userId,
      {
        location: {
          type: "Point",
          coordinates: [longitude, latitude], // GeoJSON is [lng, lat]
        },
      },
      { new: true },
    ).select("location");

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      location: updated.location,
    });
  } catch (err) {
    console.error("location update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/profile/:userId
// Get LIMITED profile of another user (discovery only, no private data)
// ⚠️ Only limited fields returned (for matching/discovery)
// ─────────────────────────────────────────────
router.get("/profile/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Validation: userId must be valid ObjectId
    if (!userId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: "Invalid userId format" });
    }

    // Validation: cannot view own profile via this endpoint (use /me instead)
    if (userId === req.userId.toString()) {
      return res
        .status(400)
        .json({ error: "Use GET /me to view your own profile" });
    }

    // Fetch public fields + location so we can show distance
    const user = await User.findById(userId).select(
      "publicId name age bio photo coverPhoto photos gender interests height relationshipGoal isOnline lastSeen location subscriptionPlan subscriptionExpiresAt photoVerification",
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const safe = await applyBlockPrivacy(
      req.userId,
      user.toObject ? user.toObject() : user,
    );

    // Log the visit for "who viewed you" + profile_view notification.
    // Fire-and-forget, and never for a blocked pair.
    if (!safe.privacyHidden && !safe.theyBlocked && !safe.iBlocked) {
      const io = req.app.get('io');
      recordProfileView(req.userId, userId, new Date(), io).catch(() => {});
    }

    // Distance from requester (WhatsApp-style "X km away")
    let distanceKm = null;
    let distanceM = null;
    try {
      const me = await User.findById(req.userId).select("location");
      const myCoords = me?.location?.coordinates;
      const theirCoords = user.location?.coordinates;
      if (
        Array.isArray(myCoords) &&
        myCoords.length >= 2 &&
        Array.isArray(theirCoords) &&
        theirCoords.length >= 2
      ) {
        const [myLng, myLat] = myCoords.map(Number);
        const [theirLng, theirLat] = theirCoords.map(Number);
        if (
          Number.isFinite(myLat) &&
          Number.isFinite(myLng) &&
          Number.isFinite(theirLat) &&
          Number.isFinite(theirLng)
        ) {
          distanceM = Math.round(
            getDistanceMetres(myLat, myLng, theirLat, theirLng),
          );
          distanceKm = (distanceM / 1000).toFixed(1);
        }
      }
    } catch {
      /* leave distance null */
    }

    const sub = serializeSubscription(user);

    const { mongoLooksOnline } = require("../utils/onlineStatus");
    const presence = require("../utils/presence");
    let isOnline = false;
    if (!safe.privacyHidden) {
      try {
        isOnline = !!(await presence.isUserOnline(String(safe._id || safe.id)));
      } catch {
        isOnline = mongoLooksOnline(safe);
      }
    }

    // Return LIMITED profile (safe for discovery/matching)
    res.json({
      id: safe._id || safe.id,
      publicId: safe.publicId || "",
      name: safe.name,
      age: safe.age ?? null,
      bio: safe.bio || "",
      photo: safe.privacyHidden ? "" : toPersistentMediaUrl(safe.photo) || "",
      coverPhoto: safe.privacyHidden ? "" : toPersistentMediaUrl(safe.coverPhoto) || "",
      photos: safe.privacyHidden
        ? []
        : sanitizePhotosArray(safe.photos || [], MAX_PROFILE_PHOTOS),
      gender: safe.gender || "",
      interests: safe.interests || [],
      height: safe.height ?? null,
      relationshipGoal: safe.relationshipGoal || "",
      isOnline,
      lastSeen: safe.privacyHidden ? null : safe.lastSeen || null,
      photoVerified:
        !safe.privacyHidden && safe.photoVerification?.status === "approved",
      distance: distanceM,
      distanceKm,
      privacyHidden: !!safe.privacyHidden,
      theyBlocked: !!safe.theyBlocked,
      iBlocked: !!safe.iBlocked,
      blockedAt: safe.blockedAt || null,
      subscriptionBadge: safe.privacyHidden ? null : sub.badge,
      subscriptionExpiresAt: safe.privacyHidden ? null : sub.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/search-by-id?publicId=ABCD1234
// Search for a user by their public ID
// ⚠️ Only limited fields returned (for discovery)
// ─────────────────────────────────────────────
router.get("/search-by-id", auth, async (req, res) => {
  try {
    const publicId = String(req.query.publicId || "")
      .toUpperCase()
      .trim();

    if (!publicId) {
      return res.status(400).json({ error: "publicId is required" });
    }

    // Validate format: ABCD1234 (4 letters + 4 digits)
    if (!/^[A-Z]{4}[0-9]{4}$/.test(publicId)) {
      return res
        .status(400)
        .json({ error: "Invalid publicId format. Expected: ABCD1234" });
    }

    // Find user by public ID (exclude self)
    const user = await User.findOne({
      publicId: publicId,
      _id: { $ne: req.userId },
      isVerified: true,
    }).select(
      "publicId name age bio photo coverPhoto photos gender interests height relationshipGoal isOnline lastSeen location subscriptionPlan subscriptionExpiresAt",
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (await isEitherBlocked(req.userId, user._id)) {
      return res.status(404).json({ error: "User not found" });
    }

    // Calculate distance from requester
    const me = await User.findById(req.userId).select("location");
    if (!me) return res.status(404).json({ error: "Your profile not found" });

    const myCoords = me.location?.coordinates || [];
    const userCoords = user.location?.coordinates || [];
    const [myLng, myLat] = myCoords.map(Number);
    const [userLng, userLat] = userCoords.map(Number);
    const distM =
      Number.isFinite(myLat) &&
      Number.isFinite(myLng) &&
      Number.isFinite(userLat) &&
      Number.isFinite(userLng)
        ? getDistanceMetres(myLat, myLng, userLat, userLng)
        : NaN;

    // Get friendship status
    const { userA, userB } = Friendship.getSortedPair(req.userId, user._id);
    const friendship = await Friendship.findOne({ userA, userB }).lean();
    const areFriends = friendship?.status === "friends";
    const iLiked =
      areFriends ||
      friendship?.status === "mutual_match" ||
      (friendship?.status === "pending_like" &&
        friendship.initiatedBy.equals(req.userId));
    const theyLiked =
      areFriends ||
      friendship?.status === "mutual_match" ||
      (friendship?.status === "pending_like" &&
        friendship.initiatedBy.equals(user._id));

    const sub = serializeSubscription(user);

    const { mongoLooksOnline } = require("../utils/onlineStatus");
    const presence = require("../utils/presence");
    let isOnline = false;
    try {
      isOnline = !!(await presence.isUserOnline(String(user._id)));
    } catch {
      isOnline = mongoLooksOnline(user);
    }

    res.json({
      id: user._id,
      publicId: user.publicId || "",
      name: user.name,
      age: user.age,
      bio: user.bio,
      photo: toPersistentMediaUrl(user.photo) || "",
      coverPhoto: toPersistentMediaUrl(user.coverPhoto) || "",
      photos: sanitizePhotosArray(user.photos || [], MAX_PROFILE_PHOTOS),
      gender: user.gender,
      interests: user.interests,
      height: user.height,
      relationshipGoal: user.relationshipGoal || "",
      isOnline,
      lastSeen: user.lastSeen,
      distance: Number.isFinite(distM) ? Math.round(distM) : null,
      distanceKm: Number.isFinite(distM) ? (distM / 1000).toFixed(1) : null,
      friendshipStatus: friendship?.status || "stranger",
      areFriends,
      iLiked,
      theyLiked,
      subscriptionBadge: sub.badge,
      subscriptionExpiresAt: sub.expiresAt,
    });
  } catch (err) {
    console.error("GET /search-by-id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Persist the Discover filters a viewer is actually browsing with.
 *
 * Fire-and-forget and only when something changed, so the common case (endless
 * scrolling with the same filters) costs no extra write.
 */
function rememberDiscoveryPrefs(userId, current, next) {
  const gender = canonicalShowMe(next.gender);
  // Kept to one decimal so sub-kilometre choices (e.g. 500 m) survive a restart.
  const radiusKm =
    Number.isFinite(next.radiusKm) && next.radiusKm > 0
      ? Math.round(next.radiusKm * 10) / 10
      : null;
  const activeWithinMinutes = Number(next.activeWithinMinutes) || 0;

  const unchanged =
    current &&
    canonicalShowMe(current.gender) === gender &&
    (current.radiusKm ?? null) === radiusKm &&
    (Number(current.activeWithinMinutes) || 0) === activeWithinMinutes;
  if (unchanged) return;

  const $set = {
    discoveryPrefs: {
      gender,
      radiusKm,
      activeWithinMinutes,
      updatedAt: new Date(),
    },
  };
  // Keep Profile "Show me" in sync with the Nearby filter the user just applied.
  if (gender) $set.showMe = gender;

  User.updateOne({ _id: userId }, { $set }).catch((err) =>
    console.warn("discoveryPrefs save failed:", err?.message || err),
  );
}

// ─────────────────────────────────────────────
// GET /api/users/nearby
// 7-day fresh rotation discovery: each batch prefers profiles this viewer has
// never seen (today's rotation bucket first), then widens to other buckets and
// finally to progressively relaxed repeat cooldowns so the feed always fills.
// Load more stays append-only via the `exclude` session list.
// ─────────────────────────────────────────────
router.get("/nearby", auth, async (req, res) => {
  try {
    // These three reads are independent — run them in one wave instead of
    // three sequential round-trips before the geo query even starts.
    const [me] = await Promise.all([
      User.findById(req.userId)
        .select("location gender showMe discoveryPrefs")
        .lean(),
      syncExpiredSubscription(req.userId),
      ensureDiscoverTopSpot(req.userId),
    ]);
    if (!me) return res.status(404).json({ error: "User not found" });

    if (!hasRealLocation(me.location?.coordinates)) {
      return res
        .status(400)
        .json({ error: "Update your location to see nearby people." });
    }

    const radiusMetres = parseInt(req.query.radius, 10) || 50000;
    const requestedGender = String(req.query.gender || "").trim();
    const genderFilter = requestedGender
      ? toGenderFilter(requestedGender)
      : toGenderFilter(resolveShowMe(me));
    const activeWithinMinutes = parseInt(req.query.activeWithin, 10) || 0;

    // Legacy params (nearbyLimit/randomLimit/limit) still drive the batch size
    // so existing callers keep working; the split itself is now handled by the
    // rotation pipeline's radius passes.
    const requested =
      (parseInt(req.query.nearbyLimit, 10) || 0) +
        (parseInt(req.query.randomLimit, 10) || 0) ||
      parseInt(req.query.limit, 10) ||
      DEFAULT_TARGET_COUNT;
    const targetCount = Math.min(Math.max(requested, 0), MAX_TARGET_COUNT);

    // Session exclusion list, newest ids kept — see MAX_SESSION_EXCLUDE.
    const excludeIds = String(req.query.exclude || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(-MAX_SESSION_EXCLUDE);

    // Callers that only read the feed (e.g. the chat online list) pass track=0
    // so they never consume a viewer's daily freshness.
    const trackImpressions = String(req.query.track || "1") !== "0";

    // Remember the viewer's filters so (a) the app can restore them after a
    // restart and (b) other people's feeds can score mutual relevance against
    // them. Only real Discover traffic counts — read-only callers such as the
    // chat online strip must not overwrite what the user actually chose.
    if (trackImpressions) {
      rememberDiscoveryPrefs(req.userId, me.discoveryPrefs, {
        gender: genderFilter,
        radiusKm: radiusMetres / 1000,
        activeWithinMinutes,
      });
    }

    const { users, hasMore } = await buildNearbyBatch({
      viewer: me,
      radiusMetres,
      genderFilter,
      activeWithinMinutes,
      excludeIds,
      targetCount,
      trackImpressions,
    });

    res.json({ users, hasMore });
  } catch (err) {
    console.error("nearby error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────
// Haversine formula helper (calculate distance between coordinates)
// ─────────────────────────────────────────────
function getDistanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/users/online-nearby
// Get online nearby users for pulse strip
router.get("/online-nearby", auth, async (req, res) => {
  try {
    const { getOnlineNearbyPulse } = require('../services/onlineNearby');
    
    const radiusKm = Number(req.query.radius) || undefined;
    const limit = Number(req.query.limit) || undefined;
    
    const result = await getOnlineNearbyPulse(req.userId, {
      radiusKm,
      limit,
    });
    
    res.json(result);
  } catch (err) {
    console.error("online-nearby error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
