'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';

// Constants defined outside component to avoid dependency warnings
const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes of no activity = idle
const HEARTBEAT_INTERVAL = 30 * 1000; // Send heartbeat every 30 seconds
const IDLE_CHECK_INTERVAL = 10 * 1000; // Check for idle every 10 seconds

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

  // Send activity data to server
  const sendActivityData = useCallback(async (data) => {
    // Don't send if user is not authenticated
    if (!user?.id) {
      return;
    }

    try {
      const response = await fetch('/api/activity-logs/track-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...data,
          userId: user.id,
          timestamp: new Date().toISOString()
        })
      });

      // Silently fail on 401 (unauthenticated) - user is being redirected to login
      if (response.status === 401) {
        return;
      }

      // Log other errors but don't throw
      if (!response.ok) {
        console.warn('Activity tracking failed:', response.status);
      }
    } catch (error) {
      // Silently fail on network errors during activity tracking
      // This prevents console spam when user is logged out
      if (error.name !== 'TypeError' || error.message !== 'Failed to fetch') {
        console.error('Failed to send activity data:', error);
      }
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

  // Track page navigation with enhanced context
  const trackPageView = useCallback((pathname) => {
    const now = Date.now();
    const timeOnPreviousPage = now - pageStartTimeRef.current;

    // Send time spent on previous page
    if (currentPageRef.current && timeOnPreviousPage > 1000) {
      // Extract more context from pathname
      const pathSegments = currentPageRef.current.split('/').filter(Boolean);
      const section = pathSegments[0] || 'home';
      const subsection = pathSegments[1] || null;
      const resourceId = pathSegments[2] || null;

      sendActivityData({
        actionType: 'view_page',
        resourceType: 'page',
        description: `Viewed ${currentPageRef.current}`,
        details: {
          page: currentPageRef.current,
          section: section,
          subsection: subsection,
          resourceId: resourceId,
          durationMs: timeOnPreviousPage,
          durationMinutes: Math.round(timeOnPreviousPage / 60000 * 10) / 10,
          referrer: document.referrer,
          scrollDepth: window.scrollY,
          viewportHeight: window.innerHeight
        }
      });
    }

    // Send new page view event
    const newPathSegments = pathname.split('/').filter(Boolean);
    const newSection = newPathSegments[0] || 'home';
    const newSubsection = newPathSegments[1] || null;

    sendActivityData({
      actionType: 'view_page',
      resourceType: 'page',
      description: `Navigated to ${pathname}`,
      details: {
        page: pathname,
        section: newSection,
        subsection: newSubsection,
        navigationType: 'navigation',
        timestamp: new Date().toISOString()
      }
    });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendActivityData]);

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
        viewportSize: `${window.innerWidth}x${window.innerHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

    // Handle browser close/tab close (beforeunload)
    const handleBeforeUnload = () => {
      const totalSessionTime = Date.now() - sessionStartRef.current;
      const timeOnPage = Date.now() - pageStartTimeRef.current;

      // Send page exit data
      if (timeOnPage > 1000) {
        navigator.sendBeacon('/api/activity-logs/track-activity', JSON.stringify({
          userId: user.id,
          actionType: 'view_page',
          resourceType: 'page',
          description: `Closed page ${currentPageRef.current}`,
          details: {
            page: currentPageRef.current,
            durationMs: timeOnPage,
            durationMinutes: Math.round(timeOnPage / 60000 * 10) / 10,
            exitType: 'browser_close'
          },
          timestamp: new Date().toISOString()
        }));
      }

      // Send session end
      navigator.sendBeacon('/api/activity-logs/track-activity', JSON.stringify({
        userId: user.id,
        actionType: 'status_change',
        resourceType: 'session',
        description: 'Browser/tab closed',
        details: {
          status: 'ended',
          exitType: 'browser_close',
          totalSessionMs: totalSessionTime,
          totalSessionMinutes: Math.round(totalSessionTime / 60000),
          activeTime: activeTimeRef.current,
          idleTime: idleTimeRef.current,
          activityCount: activityCountRef.current
        },
        timestamp: new Date().toISOString()
      }));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

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
      window.removeEventListener('mousemove', throttledMouseMove);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.id, recordActivity, trackPageView, sendHeartbeat, sendActivityData, checkIdle]);

  return {
    recordActivity,
    trackPageView,
    isIdle: isIdleRef.current
  };
}
