/**
 * Assign sample Gold / Platinum / Black subscriptions to a few verified users
 * so plan badges show in Discover and Profile.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const PLANS = ["gold", "platinum", "black"];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const candidates = await User.find({
    isVerified: true,
    name: { $nin: ["", null] },
  })
    .select("name publicId subscriptionPlan")
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  if (!candidates.length) {
    console.log("No verified named users found.");
    await mongoose.disconnect();
    return;
  }

  const picks = candidates.slice(0, Math.min(3, candidates.length));

  for (let i = 0; i < picks.length; i++) {
    const plan = PLANS[i];
    await User.updateOne(
      { _id: picks[i]._id },
      { $set: { subscriptionPlan: plan, subscriptionExpiresAt: expiresAt } },
    );
    console.log(
      `Sample ${plan}: ${picks[i].name} (${picks[i].publicId || picks[i]._id})`,
    );
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
