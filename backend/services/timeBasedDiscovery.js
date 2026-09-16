/**
 * Time-Based Discovery Modes
 * 
 * Adjusts discovery weights based on time of day.
 * Production-level with smooth transitions.
 */

const { SCORE_WEIGHTS, SLOT_PLAN } = require('./discoveryRotation');

/**
 * Get time-adjusted discovery weights.
 * 
 * Morning (6 AM - 12 PM): Favor recently active + new users
 * Afternoon (12 PM - 6 PM): Balanced
 * Evening (6 PM - 12 AM): Favor online now + high mutual score
 * Night (12 AM - 6 AM): Balanced, slightly favor online
 */
function getTimeAdjustedWeights(now = new Date()) {
  const hour = now.getHours();
  
  // Base weights (copy to avoid mutation)
  const weights = { ...SCORE_WEIGHTS };
  
  // Morning mode: 6 AM - 12 PM
  if (hour >= 6 && hour < 12) {
    return {
      ...weights,
      recency: 0.35, // Boost fresh profiles
      activity: 0.22, // Boost recently active
      mutual: 0.16,
      exposure: 0.15,
      distance: 0.08,
      quality: 0.03,
      plan: 0.01,
    };
  }
  
  // Evening mode: 6 PM - 12 AM
  if (hour >= 18 || hour < 1) {
    return {
      ...weights,
      activity: 0.3,  // Strong boost for online now
      mutual: 0.22,   // Boost mutual relevance
      recency: 0.22,
      exposure: 0.14,
      distance: 0.08,
      quality: 0.03,
      plan: 0.01,
    };
  }
  
  // Late night: 12 AM - 6 AM
  if (hour >= 1 && hour < 6) {
    return {
      ...weights,
      activity: 0.28,  // Favor online people (fewer online = higher value)
      recency: 0.25,
      mutual: 0.18,
      exposure: 0.15,
      distance: 0.1,
      quality: 0.03,
      plan: 0.01,
    };
  }
  
  // Afternoon / default: balanced
  return weights;
}

/**
 * Get time-adjusted slot plan.
 * Adjusts the mix of new/exploration/active/fresh slots.
 */
function getTimeAdjustedSlotPlan(now = new Date()) {
  const hour = now.getHours();
  
  // Base plan (copy)
  const basePlan = SLOT_PLAN.map(s => ({ ...s }));
  
  // Morning: more new users + exploration
  if (hour >= 6 && hour < 12) {
    return [
      { key: 'newUser', share: 3 },       // +1
      { key: 'exploration', share: 4 },   // +1
      { key: 'recentlyActive', share: 4 }, // -1
      { key: 'fresh', share: 14 },        // -1
    ];
  }
  
  // Evening: more online/active
  if (hour >= 18 || hour < 1) {
    return [
      { key: 'newUser', share: 1 },       // -1
      { key: 'exploration', share: 2 },   // -1
      { key: 'recentlyActive', share: 8 }, // +3
      { key: 'fresh', share: 14 },        // -1
    ];
  }
  
  // Late night: heavily favor active
  if (hour >= 1 && hour < 6) {
    return [
      { key: 'newUser', share: 1 },
      { key: 'exploration', share: 2 },
      { key: 'recentlyActive', share: 10 }, // +5
      { key: 'fresh', share: 12 },          // -3
    ];
  }
  
  // Default
  return basePlan;
}

/**
 * Get human-readable mode name for UI.
 */
function getDiscoveryModeName(now = new Date()) {
  const hour = now.getHours();
  
  if (hour >= 6 && hour < 12) return 'Morning Mix';
  if (hour >= 18 || hour < 1) return 'Evening Active';
  if (hour >= 1 && hour < 6) return 'Night Owls';
  return 'Balanced';
}

/**
 * Check if time-based adjustments are enabled.
 * Can be disabled via env var for testing.
 */
function isTimeBasedModeEnabled() {
  return process.env.DISABLE_TIME_BASED_DISCOVERY !== 'true';
}

module.exports = {
  getTimeAdjustedWeights,
  getTimeAdjustedSlotPlan,
  getDiscoveryModeName,
  isTimeBasedModeEnabled,
};
