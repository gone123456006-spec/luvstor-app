/**
 * Chat Starter Service
 * 
 * Location-based icebreakers for matched users.
 * Production-level with context-aware suggestions.
 */

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { hasRealLocation, distanceMetres } = require('./discovery');

/**
 * Get location-based chat starter suggestions.
 * Called after matching to provide contextual icebreakers.
 */
async function getChatStarters(userId, matchedUserId) {
  try {
    const [user, matched] = await Promise.all([
      User.findById(userId)
        .select('location interests relationshipGoal gender name')
        .lean(),
      User.findById(matchedUserId)
        .select('location interests relationshipGoal gender name')
        .lean(),
    ]);
    
    if (!user || !matched) return [];
    
    const starters = [];
    
    // Location-based starters
    if (hasRealLocation(user.location?.coordinates) && hasRealLocation(matched.location?.coordinates)) {
      const metres = distanceMetres(
        user.location.coordinates[1],
        user.location.coordinates[0],
        matched.location.coordinates[1],
        matched.location.coordinates[0]
      );
      const km = metres / 1000;
      
      if (km < 2) {
        starters.push({
          id: 'location_very_close',
          type: 'location',
          text: `Hey! I noticed we're both in the area. Have you been to [local spot]?`,
          context: `${Math.round(km * 10) / 10}km away`,
        });
        starters.push({
          id: 'location_meetup',
          type: 'location',
          text: `We're practically neighbors! Know any good coffee spots nearby?`,
          context: 'Very close',
        });
      } else if (km < 10) {
        starters.push({
          id: 'location_nearby',
          type: 'location',
          text: `Hey! We're both in [area]. What's your favorite spot around here?`,
          context: `${Math.round(km)}km away`,
        });
      } else if (km < 50) {
        starters.push({
          id: 'location_same_city',
          type: 'location',
          text: `Hey! Looks like we're in the same area. How long have you been here?`,
          context: `${Math.round(km)}km apart`,
        });
      }
    }
    
    // Common interests
    const commonInterests = (user.interests || []).filter(i =>
      (matched.interests || []).includes(i)
    );
    
    if (commonInterests.length > 0) {
      const interest = commonInterests[0];
      starters.push({
        id: 'interest_common',
        type: 'interest',
        text: `Hey! I saw ${interest} on your profile. How did you get into that?`,
        context: `You both like ${interest}`,
      });
      
      if (commonInterests.length >= 2) {
        starters.push({
          id: 'interest_multiple',
          type: 'interest',
          text: `We have ${commonInterests.length} interests in common! ${commonInterests[0]} and ${commonInterests[1]} especially. What's your story?`,
          context: `${commonInterests.length} shared interests`,
        });
      }
    }
    
    // Relationship goal alignment
    if (user.relationshipGoal && matched.relationshipGoal && 
        user.relationshipGoal === matched.relationshipGoal) {
      starters.push({
        id: 'goal_aligned',
        type: 'goal',
        text: `Hey! I noticed we're both looking for ${user.relationshipGoal}. What made you join Luvstor?`,
        context: `Both seeking ${user.relationshipGoal}`,
      });
    }
    
    // General friendly starters (always available)
    starters.push({
      id: 'general_profile',
      type: 'general',
      text: `Hey ${matched.name || 'there'}! Your profile caught my eye. How's your day going?`,
      context: 'Friendly opener',
    });
    
    starters.push({
      id: 'general_weekend',
      type: 'general',
      text: `Hey! What are you up to this weekend?`,
      context: 'Casual starter',
    });
    
    // Return top 4 starters (prioritize location/interests over general)
    return starters.slice(0, 4);
  } catch (err) {
    console.error('getChatStarters error:', err);
    return [];
  }
}

/**
 * Get a quick icebreaker for a specific match.
 * Returns single best starter based on context.
 */
async function getQuickIcebreaker(userId, matchedUserId) {
  try {
    const starters = await getChatStarters(userId, matchedUserId);
    
    if (starters.length === 0) {
      return {
        id: 'fallback',
        type: 'general',
        text: `Hey! How's it going?`,
        context: 'Simple greeting',
      };
    }
    
    // Prioritize: location > interest > goal > general
    const priority = ['location', 'interest', 'goal', 'general'];
    
    for (const type of priority) {
      const starter = starters.find(s => s.type === type);
      if (starter) return starter;
    }
    
    return starters[0];
  } catch (err) {
    console.error('getQuickIcebreaker error:', err);
    return {
      id: 'fallback',
      type: 'general',
      text: `Hey! How's it going?`,
      context: 'Simple greeting',
    };
  }
}

module.exports = {
  getChatStarters,
  getQuickIcebreaker,
};
