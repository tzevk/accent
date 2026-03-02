'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from '@/context/SessionContext';

const IDLE_WARNING_THRESHOLD = 1 * 60 * 1000; // 1 minute (testing — change back to 30 * 60 * 1000)
const IDLE_CHECK_INTERVAL = 5 * 1000; // Check every 5 seconds (testing — change back to 15 * 1000)
const INTERACTION_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

/**
 * useIdleMonitor - Monitors mouse/keyboard interaction idle time.
 * Shows a notification if idle > 30 min and logs the event to the server.
 *
 * Returns:
 *   idleSeconds  - current continuous idle duration in seconds
 *   isIdle       - true if user has been idle > 30 min
 *   dismiss      - function to dismiss the idle notification
 *   dismissed    - whether the user dismissed the current notification
 */
export function useIdleMonitor() {
  const { user } = useSession();
  const lastInteractionRef = useRef(Date.now());
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [cumulativeIdleSeconds, setCumulativeIdleSeconds] = useState(0);
  const prevIdleRef = useRef(0); // track previous idleSeconds to compute delta
  const [isIdle, setIsIdle] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const loggedRef = useRef(false); // prevent duplicate 30-min logs per idle stretch
  const intervalRef = useRef(null);

  // Reset idle state on activity
  const handleActivity = useCallback(() => {
    const wasIdle = isIdle;
    lastInteractionRef.current = Date.now();
    prevIdleRef.current = 0; // reset delta tracking for new streak
    setIdleSeconds(0);
    setIsIdle(false);
    setDismissed(false);

    // If coming back from a logged idle stretch, log resume
    if (wasIdle && loggedRef.current && user?.id) {
      loggedRef.current = false;
      fetch('/api/activity-logs/track-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: user.id,
          actionType: 'status_change',
          resourceType: 'idle_monitor',
          description: 'User resumed from extended idle',
          details: { status: 'resumed' },
          timestamp: new Date().toISOString()
        })
      }).catch(() => {});
    }
  }, [isIdle, user?.id]);

  // Dismiss the notification (but keep tracking — do NOT reset idle timer)
  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    // Throttle interaction events
    let throttleTimer;
    const throttledActivity = () => {
      if (!throttleTimer) {
        handleActivity();
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
        }, 2000); // throttle to once per 2 seconds
      }
    };

    // Attach listeners
    INTERACTION_EVENTS.forEach(evt => {
      window.addEventListener(evt, throttledActivity, { passive: true });
    });

    // Periodic idle check
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastInteractionRef.current;
      const secs = Math.floor(elapsed / 1000);
      // Accumulate idle delta into cumulative total
      const delta = secs - prevIdleRef.current;
      if (delta > 0) {
        setCumulativeIdleSeconds(prev => prev + delta);
      }
      prevIdleRef.current = secs;
      setIdleSeconds(secs);

      if (elapsed >= IDLE_WARNING_THRESHOLD && !loggedRef.current) {
        setIsIdle(true);
        loggedRef.current = true;

        // Log the 30-min idle event to the server
        fetch('/api/activity-logs/track-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: user.id,
            actionType: 'status_change',
            resourceType: 'idle_monitor',
            description: 'User idle for 30+ minutes',
            details: {
              status: 'idle_warning',
              idleMinutes: Math.floor(elapsed / 60000)
            },
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      }
    }, IDLE_CHECK_INTERVAL);

    return () => {
      INTERACTION_EVENTS.forEach(evt => {
        window.removeEventListener(evt, throttledActivity);
      });
      clearInterval(intervalRef.current);
      clearTimeout(throttleTimer);
    };
  }, [user?.id, handleActivity]);

  return { idleSeconds, cumulativeIdleSeconds, isIdle, dismiss, dismissed, handleActivity };
}
