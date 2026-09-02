# Delete Account Flow - Quick Start Guide

## 🎯 How to Access

**User Path:**
1. Open app
2. Go to **Profile** tab
3. Tap **Settings**
4. Tap **Account**
5. Tap **Delete Account**

## 📱 5-Step Flow

### Step 1: Warning Screen
- Shows what will be deleted (matches, chats, photos, subscription, profile)
- Checkbox: "I understand this action is permanent"
- **Continue** button (only enabled after checking box)

### Step 2: Reason for Leaving
- Select one reason:
  - Found someone
  - Privacy concerns
  - Too many notifications
  - Didn't get matches
  - Taking a break
  - Other (with text field)
- **Continue** button (enabled after selection)

### Step 3: 30-Second Reflection
- **30-second countdown timer**
- Message: "Most members regret this decision"
- Shows what user will lose
- Two buttons:
  - **Keep My Account** (goes back to Profile)
  - **Continue** (disabled for 30 seconds)

### Step 4: Type Confirmation
- User must type: **DELETE MY ACCOUNT**
- Real-time validation with green checkmark
- **Continue** button (only enabled with exact match)

### Step 5: Final Confirmation
- Shows timeline:
  1. Immediate Deactivation
  2. Profile Hidden
  3. 7-Day Grace Period
  4. Day 5 Reminder
  5. Permanent Deletion (after 7 days)
- Two buttons:
  - **Keep My Account** (cancels and goes to Profile)
  - **Delete Account** (confirms deletion)

## 🔄 What Happens After Deletion

### Immediately:
- Account deactivated
- Profile hidden from all users
- Can't send/receive messages
- Email sent: "Account Deletion Scheduled"

### Day 5 (2 days before permanent deletion):
- Email sent: "Last Chance: Account Deletion in 2 Days"
- Contains restore instructions

### Day 7:
- All data permanently deleted:
  - Profile
  - Matches
  - Chats and messages
  - Photos and uploads
  - Friendships
- Email sent: "Account Permanently Deleted"

## 🔓 How to Restore Account

### During Grace Period (Days 1-7):
**Option 1: Just log in**
- Open app and log in normally
- Account automatically restored
- Email sent: "Account Restored"

**Option 2: API call**
```javascript
POST /api/auth/restore-account
Headers: { Authorization: Bearer <token> }
```

### After Grace Period (Day 7+):
- ❌ **Cannot restore** - data is permanently deleted
- Must create new account to use Luvstor

## 🛠️ Backend API Endpoints

### Delete Account
```javascript
POST /api/auth/delete-account
Headers: { Authorization: Bearer <token> }
Body: { reason: "optional reason text" }

Response:
{
  "success": true,
  "message": "Account deactivated. You have 7 days to restore it by logging in.",
  "deletionScheduledAt": "2026-08-03T..."
}
```

### Restore Account
```javascript
POST /api/auth/restore-account
Headers: { Authorization: Bearer <token> }

Response:
{
  "success": true,
  "message": "Account restored successfully",
  "user": { ... }
}
```

## ⏰ Scheduled Jobs

The backend automatically runs these jobs **every 6 hours**:

1. **Send Deletion Reminders**
   - Finds users on Day 5
   - Sends reminder email

2. **Permanent Deletions**
   - Finds users past Day 7
   - Deletes all data
   - Sends confirmation email

## 📧 Email Notifications

### 1. Deactivation Email
- **When**: Immediately after deletion request
- **Subject**: "Account Deletion Scheduled"
- **Content**: Deletion date, grace period info, restore instructions

### 2. Day 5 Reminder
- **When**: 2 days before permanent deletion
- **Subject**: "Last Chance: Account Deletion in 2 Days"
- **Content**: Urgent reminder, restore instructions

### 3. Restoration Email
- **When**: Account is restored (auto or manual)
- **Subject**: "Account Restored"
- **Content**: Welcome back, all data intact

### 4. Permanent Deletion Email
- **When**: After 7 days
- **Subject**: "Account Permanently Deleted"
- **Content**: Confirmation, data removed, create new account if returning

## 🔧 Testing the Flow

### Quick Test:
```bash
# 1. Start backend
cd backend
npm run dev

# 2. Start frontend
cd frontend
npm start

# 3. Navigate in app
Profile → Settings → Account → Delete Account
```

### Test Auto-Restore:
1. Complete deletion flow
2. Log out
3. Log back in immediately
4. Account should be automatically restored

### Test Jobs (force run):
In backend console or create test script:
```javascript
const { sendDeletionReminders, permanentlyDeleteAccounts } = require('./jobs/accountDeletion');

// Run manually
await sendDeletionReminders();
await permanentlyDeleteAccounts();
```

## 🎨 UI Design

All screens use:
- **Primary Color**: `#6750A4` (purple)
- **Accent/Danger**: `#FF4B6E` (pink/red)
- **Material Design 3** components
- WhatsApp-style UI patterns
- Consistent spacing and borders
- Smooth animations

## 🚨 Important Security Notes

1. **No accidental deletion** - 5 screens prevent mistakes
2. **Type confirmation** - User must manually type deletion phrase
3. **30-second pause** - Forces reflection time
4. **Grace period** - 7 days to change mind
5. **Multiple emails** - Keeps user informed
6. **Auto-restore** - Simple recovery via login

## 📁 File Locations

### Frontend Screens:
```
frontend/app/
├── settings.tsx                    # Settings menu
├── settings/account.tsx            # Account settings
└── delete-account/
    ├── warning.tsx                 # Step 1
    ├── reason.tsx                  # Step 2
    ├── reflection.tsx              # Step 3
    ├── confirmation.tsx            # Step 4
    └── final.tsx                   # Step 5
```

### Backend Files:
```
backend/
├── models/User.js                  # Added deletion fields
├── routes/auth.js                  # Delete/restore routes
├── jobs/accountDeletion.js         # Scheduled jobs
└── index.js                        # Job initialization
```

## ✅ Status: READY FOR TESTING

All features are implemented and ready to use!
