/**
 * Test script for engaging notifications
 * 
 * Usage: node scripts/testEngagingNotifications.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { runEngagingNotifications } = require('../jobs/engagingNotificationScheduler');
const {
  sendNearbyNotification,
  sendActiveNowNotification,
  sendStreakNotification,
  sendConversationStarterNotification,
} = require('../services/engagingNotifications');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI not set in .env');
  }
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
}

async function testNearbyNotification() {
  console.log('\n📍 Testing Nearby Notification...');
  
  try {
    // Get two test users
    const User = require('../models/User');
    const users = await User.find({ 
      isDeactivated: { $ne: true },
      'location.coordinates': { $exists: true }
    })
      .select('_id name location')
      .limit(2)
      .lean();

    if (users.length < 2) {
      console.log('⚠️  Need at least 2 users with location to test');
      return;
    }

    const result = await sendNearbyNotification(null, users[0]._id, users[1]._id, {
      commonInterests: ['hiking', 'travel'],
    });

    if (result) {
      console.log('✅ Nearby notification created:', result.title);
    } else {
      console.log('❌ Failed to create nearby notification');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testActiveNowNotification() {
  console.log('\n🟢 Testing Active Now Notification...');
  
  try {
    const User = require('../models/User');
    const users = await User.find({ 
      isDeactivated: { $ne: true },
      lastSeen: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
    })
      .select('_id name')
      .limit(2)
      .lean();

    if (users.length < 2) {
      console.log('⚠️  Need at least 2 active users to test');
      return;
    }

    const result = await sendActiveNowNotification(null, users[0]._id, users[1]._id);

    if (result) {
      console.log('✅ Active now notification created:', result.title);
    } else {
      console.log('❌ Failed to create active now notification');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testStreakNotification() {
  console.log('\n🔥 Testing Streak Notification...');
  
  try {
    const User = require('../models/User');
    const user = await User.findOne({ 
      isDeactivated: { $ne: true }
    })
      .select('_id name')
      .lean();

    if (!user) {
      console.log('⚠️  Need at least 1 active user to test');
      return;
    }

    // Test 7-day streak
    const result = await sendStreakNotification(null, user._id, 7);

    if (result) {
      console.log('✅ Streak notification created:', result.title);
    } else {
      console.log('❌ Failed to create streak notification');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testConversationStarter() {
  console.log('\n💬 Testing Conversation Starter...');
  
  try {
    const Friendship = require('../models/Friendship');
    const friendship = await Friendship.findOne({
      status: 'friends',
      matchedAt: { 
        $gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
        $lt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    })
      .select('userA userB')
      .lean();

    if (!friendship) {
      console.log('⚠️  Need a match from 1-3 days ago to test');
      return;
    }

    const result = await sendConversationStarterNotification(
      null, 
      friendship.userA, 
      friendship.userB
    );

    if (result) {
      console.log('✅ Conversation starter created:', result.title);
    } else {
      console.log('❌ Failed to create conversation starter');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testFullScheduler() {
  console.log('\n⏰ Testing Full Scheduler Run...');
  
  try {
    const results = await runEngagingNotifications(null);
    
    console.log('\n📊 Scheduler Results:');
    console.log('  Nearby:', results.nearby);
    console.log('  Active Now:', results.activeNow);
    console.log('  Popular:', results.popular);
    console.log('  Conversation Starters:', results.conversationStarters);
    console.log('  Streaks:', results.streaks);
    console.log('  Duration:', `${results.duration}ms`);
    
    const totalSent = 
      results.nearby.sent +
      results.activeNow.sent +
      results.popular.sent +
      results.conversationStarters.sent +
      results.streaks.sent;
    
    console.log(`\n✅ Total notifications sent: ${totalSent}`);
  } catch (error) {
    console.error('❌ Scheduler error:', error.message);
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Engaging Notifications Test Suite');
  console.log('═══════════════════════════════════════');

  try {
    await connectDB();

    // Run individual tests
    await testNearbyNotification();
    await testActiveNowNotification();
    await testStreakNotification();
    await testConversationStarter();

    // Run full scheduler
    await testFullScheduler();

    console.log('\n═══════════════════════════════════════');
    console.log('  All tests completed!');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  }
}

main().catch(console.error);
