import { useRef, useCallback } from 'react';
import { apiRequest } from '../utils/api';

/**
 * View Engagement Hook
 * Tracks profile views and schedules nudges
 */
export function useViewEngagement(token: string | null) {
  const nudgeTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const trackView = useCallback(
    async (targetId: string, context?: any) => {
      if (!token || !targetId) return;

      try {
        // Track the view
        const result = await apiRequest('/api/engagement/view', token, {
          method: 'POST',
          body: JSON.stringify({ targetId, context }),
        });

        // Schedule nudge if recommended
        if (result?.shouldScheduleNudge && result.delayMs) {
          // Clear any existing timeout for this user
          const existing = nudgeTimeouts.current.get(targetId);
          if (existing) {
            clearTimeout(existing);
          }

          // Schedule new nudge
          const timeout = setTimeout(async () => {
            try {
              await apiRequest('/api/engagement/nudge', token, {
                method: 'POST',
                body: JSON.stringify({ targetId }),
              });
            } catch (err) {
              console.error('Nudge send failed:', err);
            } finally {
              nudgeTimeouts.current.delete(targetId);
            }
          }, result.delayMs);

          nudgeTimeouts.current.set(targetId, timeout);
        }
      } catch (err) {
        console.error('Track view failed:', err);
      }
    },
    [token]
  );

  const cancelNudge = useCallback((targetId: string) => {
    const timeout = nudgeTimeouts.current.get(targetId);
    if (timeout) {
      clearTimeout(timeout);
      nudgeTimeouts.current.delete(targetId);
    }
  }, []);

  const clearAllNudges = useCallback(() => {
    for (const timeout of nudgeTimeouts.current.values()) {
      clearTimeout(timeout);
    }
    nudgeTimeouts.current.clear();
  }, []);

  return {
    trackView,
    cancelNudge,
    clearAllNudges,
  };
}
