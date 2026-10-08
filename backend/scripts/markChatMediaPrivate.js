/**
 * One-time: mark media already sent in chats (photos + voice notes) as private,
 * so they are only served through signed links.
 *
 * Files that are also someone's DP / cover / gallery photo are left public.
 *
 *   node scripts/markChatMediaPrivate.js          # dry run (counts only)
 *   node scripts/markChatMediaPrivate.js --apply  # write changes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const MediaAsset = require('../models/MediaAsset');
const { mediaIdFromUrl } = require('../services/mediaStore');

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  const profileIds = new Set();
  for await (const u of User.find({}).select('photo coverPhoto photos').lean().cursor()) {
    for (const p of [u.photo, u.coverPhoto, ...(u.photos || [])]) {
      const id = typeof p === 'string' ? mediaIdFromUrl(p) : null;
      if (id) profileIds.add(id.toLowerCase());
    }
  }
  console.log(`profile photos kept public: ${profileIds.size}`);

  let scanned = 0;
  let skipped = 0;
  let marked = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map((id) => new mongoose.Types.ObjectId(id));
    batch = [];
    if (APPLY) {
      const res = await MediaAsset.updateMany(
        { _id: { $in: ids }, private: { $ne: true } },
        { $set: { private: true } },
      );
      marked += res.modifiedCount || 0;
    } else {
      marked += await MediaAsset.countDocuments({ _id: { $in: ids }, private: { $ne: true } });
    }
  };

  const seen = new Set();
  const cursor = Message.find({ type: { $in: ['image', 'audio'] }, mediaUrl: { $nin: [null, ''] } })
    .select('mediaUrl')
    .lean()
    .cursor();

  for await (const m of cursor) {
    scanned += 1;
    const id = mediaIdFromUrl(m.mediaUrl)?.toLowerCase();
    if (!id || seen.has(id) || !mongoose.Types.ObjectId.isValid(id)) continue;
    seen.add(id);
    if (profileIds.has(id)) {
      skipped += 1;
      continue;
    }
    batch.push(id);
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log(
    `${APPLY ? 'APPLIED' : 'DRY RUN'}: messages scanned=${scanned}, unique files=${seen.size}, ` +
      `left public (profile)=${skipped}, ${APPLY ? 'marked' : 'would mark'} private=${marked}`,
  );
  if (!APPLY) console.log('Re-run with --apply to write changes.');

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
