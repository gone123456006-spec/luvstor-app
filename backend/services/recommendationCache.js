/**
 * Recommendation Cache Service
 * Manages Redis caching for recommendations
 */

const Redis = require('ioredis');

class RecommendationCache {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    // Cache TTLs (seconds)
    this.SUGGESTION_TTL = 3600; // 1 hour
    this.SCORE_TTL = 86400; // 24 hours
    this.CANDIDATE_TTL = 7200; // 2 hours
  }

  /**
   * Get cached suggestions for a user's page
   */
  async getSuggestions(userId, page) {
    try {
      const key = `suggestions:${userId}:${page}`;
      const cached = await this.redis.get(key);
      
      if (!cached) return null;
      
      const data = JSON.parse(cached);
      
      // Check if stale
      const age = Date.now() - data.cachedAt;
      if (age > this.SUGGESTION_TTL * 1000) {
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Cache suggestions for a user's page
   */
  async setSuggestions(userId, page, suggestions) {
    try {
      const key = `suggestions:${userId}:${page}`;
      const data = {
        suggestions,
        total: suggestions.length,
        cachedAt: Date.now()
      };
      
      await this.redis.setex(
        key,
        this.SUGGESTION_TTL,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Invalidate all suggestions for a user
   */
  async invalidateSuggestions(userId) {
    try {
      const pattern = `suggestions:${userId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }

  /**
   * Batch get precomputed scores
   */
  async getScoresBatch(userId, candidateIds) {
    try {
      const pipeline = this.redis.pipeline();
      
      candidateIds.forEach(candidateId => {
        const key = `scores:${userId}:${candidateId}`;
        pipeline.get(key);
      });
      
      const results = await pipeline.exec();
      
      const scores = {};
      results.forEach((result, idx) => {
        const [err, value] = result;
        if (!err && value) {
          scores[candidateIds[idx]] = JSON.parse(value);
        }
      });
      
      return scores;
    } catch (error) {
      console.error('Batch get scores error:', error);
      return {};
    }
  }

  /**
   * Batch set precomputed scores
   */
  async setScoresBatch(userId, scoresMap) {
    try {
      const pipeline = this.redis.pipeline();
      
      Object.entries(scoresMap).forEach(([candidateId, scoreData]) => {
        const key = `scores:${userId}:${candidateId}`;
        pipeline.setex(
          key,
          this.SCORE_TTL,
          JSON.stringify(scoreData)
        );
      });
      
      await pipeline.exec();
    } catch (error) {
      console.error('Batch set scores error:', error);
    }
  }

  /**
   * Cache candidate pool
   */
  async setCandidatePool(userId, candidates) {
    try {
      const key = `candidates:${userId}`;
      await this.redis.setex(
        key,
        this.CANDIDATE_TTL,
        JSON.stringify(candidates)
      );
    } catch (error) {
      console.error('Set candidate pool error:', error);
    }
  }

  /**
   * Get candidate pool
   */
  async getCandidatePool(userId) {
    try {
      const key = `candidates:${userId}`;
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Get candidate pool error:', error);
      return null;
    }
  }

  /**
   * Warm cache for active users (called by background worker)
   */
  async warmCache(userId) {
    const recommendationService = require('./recommendations');
    
    try {
      const suggestions = await recommendationService.generateSuggestions(userId);
      
      // Cache first 2 pages
      if (suggestions.length > 0) {
        await this.setSuggestions(userId, 1, suggestions.slice(0, 25));
      }
      if (suggestions.length > 25) {
        await this.setSuggestions(userId, 2, suggestions.slice(25, 50));
      }
      
      return { success: true, count: suggestions.length };
    } catch (error) {
      console.error(`Warm cache failed for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get cache stats (for monitoring)
   */
  async getStats() {
    try {
      const info = await this.redis.info('stats');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        info,
        keyspace
      };
    } catch (error) {
      console.error('Get cache stats error:', error);
      return null;
    }
  }
}

module.exports = new RecommendationCache();
