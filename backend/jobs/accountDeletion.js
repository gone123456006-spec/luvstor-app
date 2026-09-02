/**
 * Scheduled jobs for account deletion reminders and permanent deletion
 */
const User = require('../models/User');
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const Upload = require('../models/Upload');
const ConversationState = require('../models/ConversationState');
const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const DeviceToken = require('../models/DeviceToken');
const DiscoveryImpression = require('../models/DiscoveryImpression');
const { sendOTPEmail } = require('../utils/email');
const fs = require('fs').promises;
const path = require('path');

/**
 * Send reminder emails to users 2 days before permanent deletion (Day 5)
 */
async function sendDeletionReminders() {
  try {
    const now = new Date();
    const twoDaysFromNow = new Date(now);
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    // Find users who are scheduled for deletion in ~2 days and haven't received reminder
    const users = await User.find({
      isDeactivated: true,
      deletionScheduledAt: {
        $gte: twoDaysFromNow,
        $lt: new Date(twoDaysFromNow.getTime() + 24 * 60 * 60 * 1000), // Within 24 hours of Day 5
      },
      reminderSentAt: null,
    });

    console.log(`[Deletion Reminder] Found ${users.length} users to remind`);

    for (const user of users) {
      try {
        const daysLeft = Math.ceil(
          (user.deletionScheduledAt - now) / (1000 * 60 * 60 * 24)
        );

        await sendOTPEmail(
          user.email,
          null,
          `Last Chance: Account Deletion in ${daysLeft} Days`,
          `Hi ${user.name || 'there'},\n\nThis is a reminder that your Luvstor account is scheduled for permanent deletion in ${daysLeft} days (on ${user.deletionScheduledAt.toLocaleDateString()}).\n\nIf you want to keep your account, simply log in before ${user.deletionScheduledAt.toLocaleDateString()} to restore it. All your matches, chats, and profile data are still safe.\n\nAfter the deletion date, all your data will be permanently deleted and cannot be recovered.\n\nTo restore your account, just log in to Luvstor.\n\nBest regards,\nLuvstor Team`
        );

        try {
          const { createNotification } = require('../services/notifications');
          await createNotification(null, {
            userId: user._id,
            type: 'system',
            title: 'Account deletion reminder',
            body: `Your account will be permanently deleted in ${daysLeft} days. Log in to restore it.`,
            data: { screen: 'settings', code: 'DELETION_REMINDER' },
          });
        } catch {
          /* ignore notification failure */
        }

        user.reminderSentAt = now;
        await user.save();

        console.log(`[Deletion Reminder] Sent to ${user.email}`);
      } catch (err) {
        console.error(`[Deletion Reminder] Failed for ${user.email}:`, err);
      }
    }
  } catch (err) {
    console.error('[Deletion Reminder] Job error:', err);
  }
}

/**
 * Permanently delete accounts past their grace period
 */
async function permanentlyDeleteAccounts() {
  try {
    const now = new Date();

    // Find users whose deletion date has passed
    const users = await User.find({
      isDeactivated: true,
      deletionScheduledAt: { $lte: now },
    });

    console.log(`[Permanent Deletion] Found ${users.length} accounts to delete`);

    for (const user of users) {
      try {
        const userId = user._id;
        const userEmail = user.email;
        const userName = user.name || 'User';

        // Delete all messages sent by this user
        await Message.deleteMany({ senderId: userId });

        // Delete all friendships (Friendship stores the pair as userA/userB)
        await Friendship.deleteMany({
          $or: [{ userA: userId }, { userB: userId }],
        });

        // Delete all conversation states (keyed by userId/otherUserId)
        await ConversationState.deleteMany({
          $or: [{ userId }, { otherUserId: userId }],
        });

        // Delete all uploads
        await Upload.deleteMany({ userId });

        // Drop Discover history on both sides so the account leaves no trace
        // in anyone else's rotation.
        await DiscoveryImpression.deleteMany({
          $or: [{ viewerId: userId }, { candidateId: userId }],
        });

        // Delete notification history and stop all push delivery
        await Notification.deleteMany({ userId });
        await NotificationLog.deleteMany({ userId });
        await DeviceToken.deleteMany({ userId });

        // Delete user's upload folder if exists
        const uploadDir = path.join(__dirname, '../uploads', String(userId));
        try {
          await fs.rm(uploadDir, { recursive: true, force: true });
          console.log(`[Permanent Deletion] Deleted upload folder: ${uploadDir}`);
        } catch (dirErr) {
          console.warn(
            `[Permanent Deletion] Could not delete upload folder:`,
            dirErr
          );
        }

        // Delete the user account
        await User.findByIdAndDelete(userId);

        // Send confirmation email
        try {
          await sendOTPEmail(
            userEmail,
            null,
            `Account Permanently Deleted`,
            `Hi ${userName},\n\nYour Luvstor account has been permanently deleted as scheduled.\n\nAll your data including profile, matches, chats, and photos have been permanently removed from our systems.\n\nIf you decide to return in the future, you'll need to create a new account.\n\nThank you for being part of Luvstor.\n\nBest regards,\nLuvstor Team`
          );
        } catch (emailErr) {
          console.error(
            `[Permanent Deletion] Failed to send confirmation email to ${userEmail}:`,
            emailErr
          );
        }

        console.log(`[Permanent Deletion] Deleted user ${userEmail} (${userId})`);
      } catch (err) {
        console.error(`[Permanent Deletion] Failed for user ${user._id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Permanent Deletion] Job error:', err);
  }
}

/**
 * Check for deactivated accounts on login and restore if within grace period
 */
async function checkAndRestoreOnLogin(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    if (user.isDeactivated && user.deletionScheduledAt) {
      const now = new Date();
      
      // If grace period has expired, prevent login
      if (now >= user.deletionScheduledAt) {
        return { error: 'Account deletion period has expired', expired: true };
      }

      // Auto-restore account on login
      user.isDeactivated = false;
      user.deletionScheduledAt = null;
      user.deletionReason = null;
      user.reminderSentAt = null;
      await user.save();

      // Send restoration email
      try {
        await sendOTPEmail(
          user.email,
          null,
          `Account Restored`,
          `Hi ${user.name || 'there'},\n\nWelcome back! Your Luvstor account has been automatically restored because you logged in within the 7-day grace period.\n\nAll your matches, chats, and profile data are intact. You can continue using Luvstor as before.\n\nBest regards,\nLuvstor Team`
        );
      } catch (emailErr) {
        console.error('Failed to send restoration email:', emailErr);
      }

      console.log(`[Auto Restore] Restored account for user ${user.email}`);
      return { restored: true, user };
    }

    return { user };
  } catch (err) {
    console.error('[Auto Restore] Error:', err);
    return null;
  }
}

module.exports = {
  sendDeletionReminders,
  permanentlyDeleteAccounts,
  checkAndRestoreOnLogin,
};
