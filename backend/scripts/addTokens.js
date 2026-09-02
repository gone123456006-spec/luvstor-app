/**
 * One-off: add tokens to users by publicId.
 * Usage: node scripts/addTokens.js WGTE0212 UJQA9331 --amount 100
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const args = process.argv.slice(2);
const amountIdx = args.indexOf("--amount");
const amount =
  amountIdx >= 0 ? Number(args[amountIdx + 1]) : 100;
const publicIds = args.filter((a) => a !== "--amount" && !a.match(/^\d+$/));

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing");
  }
  if (!publicIds.length) {
    throw new Error("Provide at least one publicId");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid --amount");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  for (const raw of publicIds) {
    const publicId = String(raw).trim().toUpperCase();
    const user = await User.findOneAndUpdate(
      { publicId },
      { $inc: { tokenBalance: amount } },
      { new: true },
    ).select("name publicId tokenBalance");

    if (user) {
      console.log(
        `Added ${amount} tokens → ${user.publicId} (${user.name || "no name"}) balance=${user.tokenBalance}`,
      );
    } else {
      console.log(`User not found: ${publicId}`);
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
