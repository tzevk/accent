'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSession } from '@/context/SessionContext';

// Constants - REDUCED frequency for better performance
const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes of no activity = idle
const HEARTBEAT_INTERVAL = 120 * 1000; // Send heartbeat every 120 seconds (was 60)
const IDLE_CHECK_INTERVAL = 60 * 1000; // Check for idle every 60 seconds (was 30)
const BATCH_INTERVAL = 30 * 1000; // Batch activities every 30 seconds (was 10)
const SKIP_INITIAL_PAGE_VIEW = true; // Don't track page view on initial load

/**
 * Activity Tracker Hook - Optimized for performance
 * Batches tracking data to reduce API calls
 */
export function useActivityTracker() {
	const { user } = useSession();
	const lastActivityRef = useRef(Date.now());
	const sessionStartRef = useRef(Date.now());
	const activeTimeRef = useRef(0);
	const idleTimeRef = useRef(0);
	const lastTickRef = useRef(Date.now()); // last precise accumulation tick
	const lastSentActiveRef = useRef(0); // active seconds reported at last heartbeat
	const lastSentIdleRef = useRef(0); // idle seconds reported at last heartbeat
	const isIdleRef = useRef(false);
	const activityCountRef = useRef(0);
	const currentPageRef = useRef('');
	const pageStartTimeRef = useRef(Date.now());
	const heartbeatIntervalRef = useRef(null);
	const idleCheckIntervalRef = useRef(null);
	const batchIntervalRef = useRef(null);
	const activityBatchRef = useRef([]);

	// Send batched activity data to server
	const flushActivityBatch = useCallback(async () => {
		if (!user?.id || activityBatchRef.current.length === 0) return;

		const batch = [...activityBatchRef.current];
		activityBatchRef.current = [];

		try {
			await fetch('/api/activity-logs/track-activity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					batch: true,
					activities: batch,
					userId: user.id,
					timestamp: new Date().toISOString(),
				}),
			});
		} catch {
			// Silently fail - don't spam console
		}
	}, [user?.id]);

	// Queue activity data (batched)
	const queueActivityData = useCallback(
		(data) => {
			if (!user?.id) return;
			activityBatchRef.current.push({
				...data,
				userId: user.id,
				timestamp: new Date().toISOString(),
			});
		},
		[user?.id]
	);

	// Send important activity data immediately
	const sendActivityData = useCallback(
		async (data) => {
			if (!user?.id) return;

			try {
				await fetch('/api/activity-logs/track-activity', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						...data,
						userId: user.id,
						timestamp: new Date().toISOString(),
					}),
				});
			} catch {
				// Silently fail
			}
		},
		[user?.id]
	);

	// Record user activity (batched, not immediate)
	const recordActivity = useCallback(() => {
		const now = Date.now();

		// If was idle, mark as active again
		if (isIdleRef.current) {
			isIdleRef.current = false;
			queueActivityData({
				actionType: 'status_change',
				resourceType: 'session',
				description: 'User became active',
				details: { status: 'active' },
			});
		}

		lastActivityRef.current = now;
		activityCountRef.current++;
	}, [queueActivityData]);

	// Track page navigation
	const trackPageView = useCallback(
		(pathname) => {
			const now = Date.now();
			const timeOnPreviousPage = now - pageStartTimeRef.current;

			// Only track if spent more than 2 seconds on previous page
			if (currentPageRef.current && timeOnPreviousPage > 2000) {
				queueActivityData({
					actionType: 'view_page',
					resourceType: 'page',
					description: `Viewed ${currentPageRef.current}`,
					details: {
						page: currentPageRef.current,
						durationMs: timeOnPreviousPage,
					},
				});
			}

			currentPageRef.current = pathname;
			pageStartTimeRef.current = now;
		},
		[queueActivityData]
	);

	// Send heartbeat — reports the delta since the last heartbeat (bucket
	// model), plus the legacy session totals for backward compatibility.
	const sendHeartbeat = useCallback(() => {
		const now = Date.now();
		const sessionDuration = now - sessionStartRef.current;
		const activeDeltaMs = activeTimeRef.current - lastSentActiveRef.current;
		const idleDeltaMs = idleTimeRef.current - lastSentIdleRef.current;
		lastSentActiveRef.current = activeTimeRef.current;
		lastSentIdleRef.current = idleTimeRef.current;

		queueActivityData({
			actionType: 'other',
			resourceType: 'heartbeat',
			description: 'Session heartbeat',
			details: {
				sessionDurationMs: sessionDuration,
				activeDeltaMs,
				idleDeltaMs,
				activeTime: activeTimeRef.current,
				idleTime: idleTimeRef.current,
				activityCount: activityCountRef.current,
				isIdle: isIdleRef.current,
				currentPage: currentPageRef.current,
			},
		});
	}, [queueActivityData]);

	// Check for idle state — accumulates precise elapsed time since the
	// last tick (not a fixed interval), capped so a background-tab timer
	// gap is never attributed wholesale to active/idle time.
	const checkIdle = useCallback(() => {
		const now = Date.now();
		const timeSinceLastActivity = now - lastActivityRef.current;

		if (timeSinceLastActivity > IDLE_THRESHOLD && !isIdleRef.current) {
			isIdleRef.current = true;
			queueActivityData({
				actionType: 'status_change',
				resourceType: 'session',
				description: 'User became idle',
				details: { status: 'idle' },
			});
		}

		const delta = Math.min(now - lastTickRef.current, IDLE_CHECK_INTERVAL * 3);
		if (delta > 0) {
			lastTickRef.current = now;
			if (isIdleRef.current) {
				idleTimeRef.current += delta;
			} else {
				activeTimeRef.current += delta;
			}
		}
	}, [queueActivityData]);

	// Set up event listeners
	useEffect(() => {
		if (!user?.id) return;

		// Throttled activity recording (only update timestamp, don't send data)
		let activityTimeout;
		const throttledActivity = () => {
			if (!activityTimeout) {
				recordActivity();
				activityTimeout = setTimeout(() => {
					activityTimeout = null;
				}, 5000); // Throttle to once per 5 seconds
			}
		};

		// Add event listeners
		window.addEventListener('mousemove', throttledActivity, { passive: true });
		window.addEventListener('click', throttledActivity, { passive: true });
		window.addEventListener('keydown', throttledActivity, { passive: true });
		window.addEventListener('scroll', throttledActivity, { passive: true });

		// Track page visibility changes
		const handleVisibilityChange = () => {
			if (document.hidden) {
				isIdleRef.current = true;
			} else {
				recordActivity();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// Track initial page - but don't send API call immediately
		// Just store the path, will be sent on next actual user interaction or heartbeat
		currentPageRef.current = window.location.pathname;
		pageStartTimeRef.current = Date.now();

		// Set up intervals - but delay start to not interfere with page load
		setTimeout(() => {
			heartbeatIntervalRef.current = setInterval(
				sendHeartbeat,
				HEARTBEAT_INTERVAL
			);
			idleCheckIntervalRef.current = setInterval(
				checkIdle,
				IDLE_CHECK_INTERVAL
			);
			batchIntervalRef.current = setInterval(
				flushActivityBatch,
				BATCH_INTERVAL
			);
		}, 5000); // Wait 5 seconds after mount before starting intervals

		// Don't send initial session start immediately - queue it for the first batch
		queueActivityData({
			actionType: 'status_change',
			resourceType: 'session',
			description: 'Session started',
			details: { status: 'active' },
		});

		// Handle browser close
		const handleBeforeUnload = () => {
			flushActivityBatch();

			// Flush the interval not yet covered by a heartbeat.
			const activeDeltaMs = activeTimeRef.current - lastSentActiveRef.current;
			const idleDeltaMs = idleTimeRef.current - lastSentIdleRef.current;
			lastSentActiveRef.current = activeTimeRef.current;
			lastSentIdleRef.current = idleTimeRef.current;

			const totalSessionTime = Date.now() - sessionStartRef.current;
			navigator.sendBeacon(
				'/api/activity-logs/track-activity',
				JSON.stringify({
					userId: user.id,
					actionType: 'other',
					resourceType: 'heartbeat',
					description: 'Session ended',
					details: {
						status: 'ended',
						totalSessionMs: totalSessionTime,
						activeDeltaMs,
						idleDeltaMs,
						activeTime: activeTimeRef.current,
						idleTime: idleTimeRef.current,
					},
					timestamp: new Date().toISOString(),
				})
			);
		};

		window.addEventListener('beforeunload', handleBeforeUnload);

		// Track navigation
		const handlePopstate = () => trackPageView(window.location.pathname);
		window.addEventListener('popstate', handlePopstate);

		// Cleanup
		return () => {
			window.removeEventListener('mousemove', throttledActivity);
			window.removeEventListener('click', throttledActivity);
			window.removeEventListener('keydown', throttledActivity);
			window.removeEventListener('scroll', throttledActivity);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			window.removeEventListener('popstate', handlePopstate);
			document.removeEventListener('visibilitychange', handleVisibilityChange);

			clearInterval(heartbeatIntervalRef.current);
			clearInterval(idleCheckIntervalRef.current);
			clearInterval(batchIntervalRef.current);
			clearTimeout(activityTimeout);
		};
	}, [
		user?.id,
		recordActivity,
		trackPageView,
		sendHeartbeat,
		sendActivityData,
		checkIdle,
		flushActivityBatch,
	]);

	return { recordActivity, trackPageView, isIdle: isIdleRef.current };
}
