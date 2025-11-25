'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';

/**
 * Activity Tracker Hook
 * Tracks screen time, mouse movements, clicks, keyboard input, and idle detection
 */
export function useActivityTracker() {
  const { user } = useSessionRBAC();
  const lastActivityRef = useRef(Date.now());
  const sessionStartRef = useRef(Date.now());
  const activeTimeRef = useRef(0);
  const idleTimeRef = useRef(0);
  const isIdleRef = useRef(false);
  const activityCountRef = useRef(0);
  const currentPageRef = useRef('');
  const pageStartTimeRef = useRef(Date.now());
  const heartbeatIntervalRef = useRef(null);
  const idleCheckIntervalRef = useRef(null);

  const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes of no activity = idle
  const HEARTBEAT_INTERVAL = 30 * 1000; // Send heartbeat every 30 seconds
  const IDLE_CHECK_INTERVAL = 10 * 1000; // Check for idle every 10 seconds

  // Send activity data to server
  const sendActivityData = useCallback(async (data) => {
    if (!user?.id) return;

    try {
      await fetch('/api/activity-logs/track-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          userId: user.id,
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      console.error('Failed to send activity data:', error);
    }
  }, [user?.id]);

  // Record user activity
  const recordActivity = useCallback((activityType, details = {}) => {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityRef.current;

    // If was idle, mark as active again
    if (isIdleRef.current) {
      isIdleRef.current = false;
      sendActivityData({
        actionType: 'status_change',
        resourceType: 'session',
        description: 'User became active',
        details: { status: 'active', idleTime: timeSinceLastActivity }
      });
    }

    lastActivityRef.current = now;
    activityCountRef.current++;

    // Send specific activity
    if (activityType) {
      sendActivityData({
        actionType: activityType,
        resourceType: 'interaction',
        description: `User ${activityType}`,
        details
      });
    }
  }, [sendActivityData]);

  // Track page navigation
  const trackPageView = useCallback((pathname) => {
    const now = Date.now();
    const timeOnPreviousPage = now - pageStartTimeRef.current;

    // Send time spent on previous page
    if (currentPageRef.current && timeOnPreviousPage > 1000) {
      sendActivityData({
        actionType: 'view_page',
        resourceType: 'page',
        description: `Viewed ${currentPageRef.current}`,
        details: {
          page: currentPageRef.current,
          durationMs: timeOnPreviousPage,
          durationMinutes: Math.round(timeOnPreviousPage / 60000 * 10) / 10
        }
      });
    }

    // Update current page
    currentPageRef.current = pathname;
    pageStartTimeRef.current = now;
  }, [sendActivityData]);

  // Send heartbeat with session info
  const sendHeartbeat = useCallback(() => {
    const now = Date.now();
    const sessionDuration = now - sessionStartRef.current;
    const timeSinceLastActivity = now - lastActivityRef.current;

    sendActivityData({
      actionType: 'other',
      resourceType: 'heartbeat',
      description: 'Session heartbeat',
      details: {
        sessionDurationMs: sessionDuration,
        sessionDurationMinutes: Math.round(sessionDuration / 60000),
        activeTime: activeTimeRef.current,
        idleTime: idleTimeRef.current,
        activityCount: activityCountRef.current,
        isIdle: isIdleRef.current,
        currentPage: currentPageRef.current,
        timeSinceLastActivity: timeSinceLastActivity
      }
    });
  }, [sendActivityData]);

  // Check for idle state
  const checkIdle = useCallback(() => {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityRef.current;

    if (timeSinceLastActivity > IDLE_THRESHOLD && !isIdleRef.current) {
      // User became idle
      isIdleRef.current = true;
      sendActivityData({
        actionType: 'status_change',
        resourceType: 'session',
        description: 'User became idle',
        details: { 
          status: 'idle', 
          idleThreshold: IDLE_THRESHOLD,
          timeSinceLastActivity 
        }
      });
    }

    // Update time counters
    if (isIdleRef.current) {
      idleTimeRef.current += IDLE_CHECK_INTERVAL;
    } else {
      activeTimeRef.current += IDLE_CHECK_INTERVAL;
    }
  }, [sendActivityData, IDLE_CHECK_INTERVAL, IDLE_THRESHOLD]);

  // Set up event listeners
  useEffect(() => {
    if (!user?.id) return;

    // Track various user interactions
    const handleMouseMove = () => recordActivity('mouse_move', { type: 'mouse' });
    const handleClick = (e) => recordActivity('click', { 
      type: 'click',
      x: e.clientX,
      y: e.clientY,
      target: e.target.tagName
    });
    const handleKeyPress = () => recordActivity('keypress', { type: 'keyboard' });
    const handleScroll = () => recordActivity('scroll', { type: 'scroll' });
    const handleFocus = () => recordActivity('focus', { type: 'window_focus' });
    const handleBlur = () => {
      isIdleRef.current = true;
      sendActivityData({
        actionType: 'status_change',
        resourceType: 'session',
        description: 'User left window/tab',
        details: { status: 'away' }
      });
    };

    // Throttle mouse move events
    let mouseMoveTimeout;
    const throttledMouseMove = () => {
      if (!mouseMoveTimeout) {
        mouseMoveTimeout = setTimeout(() => {
          handleMouseMove();
          mouseMoveTimeout = null;
        }, 5000); // Only record mouse movement every 5 seconds
      }
    };

    // Track page visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        sendActivityData({
          actionType: 'status_change',
          resourceType: 'session',
          description: 'Tab hidden',
          details: { visibility: 'hidden' }
        });
      } else {
        sendActivityData({
          actionType: 'status_change',
          resourceType: 'session',
          description: 'Tab visible',
          details: { visibility: 'visible' }
        });
        recordActivity('focus', { type: 'visibility_change' });
      }
    };

    // Add event listeners
    window.addEventListener('mousemove', throttledMouseMove);
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Track initial page view
    trackPageView(window.location.pathname);

    // Set up heartbeat interval
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Set up idle check interval
    idleCheckIntervalRef.current = setInterval(checkIdle, IDLE_CHECK_INTERVAL);

    // Send initial session start
    sendActivityData({
      actionType: 'status_change',
      resourceType: 'session',
      description: 'Session started',
      details: { 
        status: 'active',
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        viewportSize: `${window.innerWidth}x${window.innerHeight}`
      }
    });

    // Track navigation
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function(...args) {
      originalPushState.apply(this, args);
      trackPageView(window.location.pathname);
    };

    window.history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      trackPageView(window.location.pathname);
    };

    window.addEventListener('popstate', () => {
      trackPageView(window.location.pathname);
    });

    // Cleanup on unmount or user change
    return () => {
      // Capture ref values at cleanup start to avoid stale closure warnings
      const sessionStart = sessionStartRef.current;
      const activityCount = activityCountRef.current;
      const pageStartTime = pageStartTimeRef.current;
      const currentPage = currentPageRef.current;
      const activeTime = activeTimeRef.current;
      const idleTime = idleTimeRef.current;
      
      window.removeEventListener('mousemove', throttledMouseMove);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
      }

      // Send final page time
      const timeOnPage = Date.now() - pageStartTime;
      if (timeOnPage > 1000) {
        sendActivityData({
          actionType: 'view_page',
          resourceType: 'page',
          description: `Left ${currentPage}`,
          details: {
            page: currentPage,
            durationMs: timeOnPage,
            durationMinutes: Math.round(timeOnPage / 60000 * 10) / 10
          }
        });
      }

      // Send session end
      const totalSessionTime = Date.now() - sessionStart;
      sendActivityData({
        actionType: 'status_change',
        resourceType: 'session',
        description: 'Session ended',
        details: {
          status: 'ended',
          totalSessionMs: totalSessionTime,
          totalSessionMinutes: Math.round(totalSessionTime / 60000),
          activeTime: activeTime,
          idleTime: idleTime,
          activityCount: activityCount
        }
      });

      // Restore original history methods
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [user?.id, recordActivity, trackPageView, sendHeartbeat, sendActivityData, checkIdle, HEARTBEAT_INTERVAL, IDLE_CHECK_INTERVAL]);

  return {
    recordActivity,
    trackPageView,
    isIdle: isIdleRef.current
  };
}
