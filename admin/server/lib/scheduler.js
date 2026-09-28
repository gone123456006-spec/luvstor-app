const { Campaign } = require('../models/admin');
const { User } = require('../models/app');
const { mainApi } = require('./mainApi');
const { segmentFilter, audienceQuery } = require('./segments');

const TICK_MS = 30_000;
const STUCK_MS = 10 * 60_000;
let timer = null;
let running = false;

/**
 * Atomically claims due campaigns, so running several admin instances never
 * sends a campaign twice. A campaign stuck in "sending" (crash mid-send) is
 * marked failed rather than retried, to avoid double pushes.
 */
async function tick() {
  if (running) return;
  running = true;
  try {
    await Campaign.updateMany(
      { status: 'sending', claimedAt: { $lt: new Date(Date.now() - STUCK_MS) } },
      { $set: { status: 'failed', error: 'Interrupted while sending — not retried to avoid duplicates' } },
    );
    for (let i = 0; i < 5; i += 1) {
      const now = new Date();
      const campaign = await Campaign.findOneAndUpdate(
        { status: 'scheduled', sendAt: { $lte: now } },
        { $set: { status: 'sending', claimedAt: now } },
        { sort: { sendAt: 1 }, returnDocument: 'after' },
      );
      if (!campaign) break;
      await sendCampaign(campaign);
    }
  } catch (err) {
    console.error('[scheduler] tick failed:', err.message);
  } finally {
    running = false;
  }
}

async function sendCampaign(campaign) {
  try {
    const filter = segmentFilter(campaign.segment);
    if (!filter) throw new Error(`Unknown segment ${campaign.segment}`);
    const audience = await User.countDocuments(audienceQuery(campaign.segment));
    await mainApi('/api/notifications/broadcast', {
      method: 'POST',
      body: {
        type: campaign.type,
        title: campaign.title,
        body: campaign.body,
        deepLink: campaign.deepLink,
        filter,
        data: { campaignId: String(campaign._id) },
      },
    });
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.audienceAtSend = audience;
    campaign.error = '';
  } catch (err) {
    campaign.status = 'failed';
    campaign.error = String(err.message || err).slice(0, 500);
  }
  await campaign.save();
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  setTimeout(tick, 5_000).unref();
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startScheduler, stopScheduler, tick };
