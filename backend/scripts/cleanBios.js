/**
 * One-time: apply bio rules (utils/bioFilter.js) to bios saved before they existed.
 * Phone numbers are masked; bios with emails / handles / "luvstor" are cleared.
 *
 *   node scripts/cleanBios.js          # dry run (prints counts + examples)
 *   node scripts/cleanBios.js --apply  # write changes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const { checkBio } = require('../utils/bioFilter');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  let scanned = 0;
  let masked = 0;
  let cleared = 0;
  const ops = [];
  const flush = async () => {
    if (APPLY && ops.length) await User.bulkWrite(ops.splice(0), { ordered: false });
    else ops.length = 0;
  };

  const cursor = User.find({ bio: { $nin: [null, ''] } }).select('bio publicId').lean().cursor();
  for await (const u of cursor) {
    scanned += 1;
    const verdict = checkBio(u.bio);
    const next = verdict.ok ? verdict.bio : '';
    if (next === String(u.bio).trim()) continue;
    if (verdict.ok) masked += 1;
    else cleared += 1;
    if (masked + cleared <= 10) {
      console.log(`${u.publicId || u._id}: ${verdict.ok ? 'mask' : `clear (${verdict.code})`}`);
    }
    ops.push({ updateOne: { filter: { _id: u._id }, update: { $set: { bio: next } } } });
    if (ops.length >= 500) await flush();
  }
  await flush();

  console.log(
    `${APPLY ? 'APPLIED' : 'DRY RUN'}: scanned=${scanned}, phone-masked=${masked}, cleared=${cleared}`,
  );
  if (!APPLY) console.log('Re-run with --apply to write changes.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
