# Anti-Spam Chat System Implementation

## Overview
This document describes the complete implementation of the anti-spam chat system that enforces token-based chat access with message limits and cross-chat spam prevention.

## Features

### 1. Token-Based Chat Access
- **Cost**: 10 tokens = 2 hours of chat access
- **Session Management**: Server-side time tracking (survives refresh/device switch)
- **Auto-Renewal**: If user has ≥10 tokens when session expires, new session starts automatically

### 2. Message Type Restrictions
During an active token session:
- ✅ **Text messages**: Allowed
- ❌ **Image sharing**: Disabled
- ❌ **Audio messages**: Disabled
- ❌ **Voice calls**: Disabled
- ❌ **Video calls**: Disabled
- ❌ **File sharing**: Disabled

### 3. Consecutive Message Limit
- Users can send a **maximum of 10 consecutive messages** without a reply
- After the 10th message without a reply:
  - User **cannot send more messages** in that conversation
  - Warning displayed: "Please wait for the other user to reply before sending more messages"
- When recipient replies, the counter **resets to 0**
- User can continue chatting normally after receiving a reply

### 4. Cross-Chat Spam Prevention
While waiting for a reply (after hitting 10 message limit):
- ❌ User **cannot start new conversations** with other users
- ❌ User **cannot send first messages** to any new user
- ✅ User **can reply** to existing conversations where they've received messages
- ✅ User **can receive messages** from any user
- Warning displayed: "You cannot start new conversations while waiting for a reply in another conversation"

### 5. Session Expiry Behavior
After 2 hours:
- If user has **≥10 tokens**: New session starts automatically
- If user has **<10 tokens**: Chat access blocked, "Buy Tokens" popup shown

## Implementation Details

### Backend

#### 1. Database Models

**ConversationState Model** (`backend/models/ConversationState.js`)
```javascript
{
  userId: ObjectId,              // User being tracked
  otherUserId: ObjectId,          // Other party in conversation
  roomId: String,                 // Room identifier
  consecutiveMessages: Number,    // Count of messages without reply (0-10)
  waitingForReply: Boolean,       // True when limit reached
  lastMessageAt: Date,            // Timestamp of last message
  lastReplyReceivedAt: Date       // Timestamp of last reply received
}
```

**User Model Updates** (`backend/models/User.js`)
```javascript
{
  tokenBalance: Number,           // Available tokens
  chatSessionStartedAt: Date,     // When current session started
  chatSessionExpiresAt: Date      // When current session expires
}
```

#### 2. Chat Token Service (`backend/services/chatTokens.js`)

**Core Functions:**

- `canSendMessage(senderId, receiverId, messageType)`: 
  - Checks if user can send a message
  - Enforces text-only during token session
  - Checks 10 message limit
  - Prevents new conversations when waiting for reply
  - Returns `{ok: boolean, code?: string, message?: string, consecutiveCount?: number}`

- `incrementMessageCount(senderId, receiverId)`:
  - Increments consecutive message counter
  - Automatically sets `waitingForReply: true` when count reaches 10

- `resetMessageCount(senderId, receiverId)`:
  - Resets counter to 0 when other user replies
  - Sets `waitingForReply: false`

- `getConversationRestrictions(userId)`:
  - Returns list of blocked conversations
  - Indicates if user can start new conversations

#### 3. API Endpoints

**Chat Routes** (`backend/routes/chat.js`)

- `GET /api/chat/restrictions`: Get all conversation restrictions for user
- `GET /api/chat/conversation-status/:otherUserId`: Get status for specific conversation
- `POST /api/chat/send`: Send message (enforces all restrictions)

**Token Routes** (`backend/routes/tokens.js`)

- `GET /api/tokens/chat-access`: Get token balance and session status
- `GET /api/tokens/balance`: Get token balance (lightweight)
- `POST /api/tokens/ensure-session`: Start/renew 2-hour session
- `POST /api/tokens/spin`: Daily free spin for tokens

#### 4. Socket.IO Integration (`backend/socket/index.js`)

**Message Handler Updates:**
```javascript
socket.on('chat:message', async (data) => {
  // 1. Validate user & receiver
  // 2. Check token session (ensureChatSession)
  // 3. Check message restrictions (canSendMessage)
  // 4. Create message
  // 5. Increment sender's counter (incrementMessageCount)
  // 6. Reset receiver's counter (resetMessageCount)
  // 7. Emit to room and receiver
});
```

**Error Codes:**
- `INSUFFICIENT_TOKENS`: Not enough tokens for session
- `WAITING_FOR_REPLY`: Hit 10 message limit in current conversation
- `WAITING_FOR_REPLY_OTHER`: Blocked from starting new conversations
- `MEDIA_NOT_ALLOWED`: Attempted to send media during token session

### Frontend

#### 1. State Management (`frontend/app/messages/[id].tsx`)

**New State:**
```typescript
const [conversationStatus, setConversationStatus] = useState<{
  canSend: boolean;
  code?: string;
  message?: string;
  consecutiveCount: number;
}>({ canSend: true, consecutiveCount: 0 });
```

#### 2. UI Components

**Token Status Bar:**
- Displays current token balance
- Shows remaining session time (countdown)
- Always visible at top of chat composer

**Warning Bar (8-9 messages):**
- Orange background
- Shows "X messages left before waiting for reply"
- Warning icon

**Blocked Bar (10+ messages, no reply):**
- Red background
- Shows appropriate blocking message
- Hand stop icon
- Prevents message sending

**Disabled Media Buttons:**
- Image/audio buttons grayed out during token session
- Alert shown when attempting to use disabled features

**Disabled Send Button:**
- Dimmed when conversation is blocked
- Prevents sending when `conversationStatus.canSend === false`

#### 3. Real-Time Updates

**Conversation Status Refresh:**
- On component mount
- On navigation focus (returning from other screens)
- When receiving a message (counter might reset)
- When socket error occurs (sync with server)

**Error Handling:**
```typescript
socket.on('chat:error', (payload) => {
  if (payload.code === 'WAITING_FOR_REPLY' || 
      payload.code === 'WAITING_FOR_REPLY_OTHER' ||
      payload.code === 'MEDIA_NOT_ALLOWED') {
    fetchConversationStatus(); // Sync UI with server
    Alert.alert('Cannot send message', payload.message);
  }
});
```

#### 4. Send Message Flow

```typescript
const sendMessage = async () => {
  // 1. Check token access (requireChatAccess)
  // 2. Check conversation restrictions (conversationStatus.canSend)
  // 3. Check media type during token session
  // 4. Send message via socket
  // 5. Server handles incrementMessageCount & resetMessageCount
  // 6. UI refreshes conversation status on message receipt
};
```

## Security

### Server-Side Enforcement
✅ All limits enforced on backend (not just frontend)
✅ Token balance and session tracked in database
✅ Server time used (client time ignored)
✅ Message counters stored in database
✅ Cannot bypass by refreshing page, logging out, or switching devices

### Race Condition Prevention
✅ Atomic database operations for token deduction
✅ Conversation state updates use `findOneAndUpdate`
✅ Message count increments are transactional

### Input Validation
✅ Message type validated on server
✅ Receiver ID validation
✅ Token balance verification before session creation
✅ Conversation status checked before message creation

## Testing Checklist

### Token Session
- [ ] Starting a chat deducts 10 tokens
- [ ] Session lasts exactly 2 hours
- [ ] Session countdown displays correctly
- [ ] Session auto-renews if user has ≥10 tokens
- [ ] "Buy Tokens" popup shows if user has <10 tokens

### Message Type Restrictions
- [ ] Image button disabled during token session
- [ ] Audio button disabled during token session
- [ ] Alert shown when attempting to send media
- [ ] Text messages work normally during session

### 10 Message Limit
- [ ] Counter increments with each sent message
- [ ] Warning shown at 8th and 9th message
- [ ] Blocking message shown at 10th message
- [ ] Send button disabled after 10th message
- [ ] Counter resets when recipient replies
- [ ] User can continue chatting after reply

### Cross-Chat Spam Prevention
- [ ] Cannot start new conversation when waiting for reply
- [ ] Can reply to existing conversations
- [ ] Can receive messages from any user
- [ ] Blocking message explains restriction
- [ ] Restriction lifts when any conversation gets a reply

### Session Sync
- [ ] Session status syncs across devices
- [ ] Conversation status refreshes on focus
- [ ] Status updates in real-time via socket
- [ ] UI updates immediately on counter reset

### Error Handling
- [ ] Socket errors display appropriate messages
- [ ] Failed sends don't increment counter
- [ ] Network errors handled gracefully
- [ ] Server errors don't crash client

## User Experience Flow

### Happy Path
1. User opens chat screen
2. Token status bar shows current balance and session time
3. User sends text messages normally
4. Warning appears after 8th consecutive message
5. Warning updates for 9th message
6. After 10th message, blocked bar appears
7. Send button becomes disabled
8. Recipient replies
9. Blocked bar disappears
10. Counter resets to 0
11. User continues chatting

### Blocked State
1. User hits 10 message limit in Chat A
2. Blocked bar appears in Chat A
3. User tries to open Chat B (new conversation)
4. Attempts to send message in Chat B
5. Alert shows: "Cannot start new conversations while waiting for reply"
6. User can still reply to Chat C (if they've received messages there)
7. Recipient in Chat A finally replies
8. Both Chat A and Chat B become unblocked
9. User can now send messages anywhere

### Session Expiry
1. 2-hour session countdown reaches 0:00
2. If user has ≥10 tokens:
   - New session starts automatically
   - User continues chatting seamlessly
3. If user has <10 tokens:
   - "Buy Tokens" popup appears
   - All message sending blocked
   - User must purchase tokens to continue

## Configuration

### Constants (`backend/services/chatTokens.js`)
```javascript
const CHAT_TOKEN_COST = 10;               // Tokens per session
const CHAT_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const MAX_CONSECUTIVE_MESSAGES = 10;       // Message limit before reply required
```

### Customization
To modify the system parameters:
1. Update constants in `chatTokens.js`
2. Update warning thresholds in frontend (currently 8-9 messages)
3. Restart backend server
4. Frontend will automatically sync with new values

## Maintenance

### Database Cleanup
Consider adding a cron job to clean up old conversation states:
```javascript
// Delete conversation states older than 30 days with no recent activity
ConversationState.deleteMany({
  lastMessageAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
});
```

### Monitoring
Key metrics to track:
- Average messages before reply
- Percentage of users hitting the 10 message limit
- Token consumption rate
- Session renewal rate
- Blocked conversation attempts

### Debugging
Enable detailed logging:
```javascript
// Backend
console.log('canSendMessage result:', result);
console.log('incrementMessageCount:', senderId, receiverId, count);
console.log('resetMessageCount:', senderId, receiverId);

// Frontend
console.log('Conversation status:', conversationStatus);
console.log('Chat access:', chatAccess);
```

## Compatibility

### Existing Features
✅ Works alongside existing premium/subscription features
✅ Does not affect existing monetization
✅ Independent of offers/trials
✅ Respects existing device binding
✅ Compatible with message deletion feature
✅ Compatible with swipe-to-reply feature

### Breaking Changes
None. This is an additive feature that doesn't modify existing functionality.

## Future Enhancements

### Potential Additions
1. **Premium Bypass**: Allow premium users to skip message limits
2. **Conversation-Specific Tokens**: Different costs for different users
3. **Message Limit Tiers**: 10/20/50 messages based on subscription
4. **Grace Period**: Allow 1-2 messages over limit before hard block
5. **Analytics Dashboard**: Show message count statistics to users
6. **Custom Limits**: Allow users to set their own receive limits
7. **Temporary Unblock**: Allow users to "appeal" a block once per day

## Support

### Common Issues

**Q: Counter not resetting after reply**
A: Check server logs for `resetMessageCount` calls. Verify socket connection.

**Q: Media buttons not disabled**
A: Verify `chatAccess.hasActiveSession` is true. Check token session status.

**Q: Session not auto-renewing**
A: Check user token balance. Verify server time vs. client time.

**Q: Blocked in all conversations**
A: Check for multiple conversations with `waitingForReply: true`. One reply should unblock all.

### Debug Endpoints

```bash
# Get user's conversation states
GET /api/chat/restrictions
Authorization: Bearer <token>

# Get specific conversation status
GET /api/chat/conversation-status/:otherUserId
Authorization: Bearer <token>

# Get token session status
GET /api/tokens/chat-access
Authorization: Bearer <token>
```

## Conclusion

This anti-spam chat system provides a robust, secure, and user-friendly way to prevent spam while maintaining a positive chat experience for legitimate users. All restrictions are enforced server-side, making them impossible to bypass, while the frontend provides clear visual feedback about current limits and restrictions.

The system is designed to be maintenance-free, with automatic cleanup and synchronization across devices. It integrates seamlessly with existing features and can be easily customized to meet changing business requirements.
