'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useActivityTracker } from '@/hooks/useActivityTracker';

/**
 * Activity Tracker Component
 * Automatically tracks all user activity when mounted
 */
export default function ActivityTracker() {
	const { trackPageView } = useActivityTracker();
	const pathname = usePathname();
	const lastPathRef = useRef(pathname);

	// Next.js App Router navigation uses pushState, which does NOT fire
	// `popstate` — so page views must be reported from the pathname here.
	// Initialized to the current path so the first mount isn't tracked.
	useEffect(() => {
		if (pathname !== lastPathRef.current) {
			lastPathRef.current = pathname;
			trackPageView(pathname);
		}
	}, [pathname, trackPageView]);

	// ── Work Session close beacon (#331, app-wide since #386): end the caller's
	// own Work Session when the tab or window goes away without a Sign out.
	// `pagehide` fires on a real unload (tab close, window close, navigating
	// away) and never on in-app client navigation, so moving around the app
	// keeps the session open. The endpoint ends the caller's own session from
	// the session cookie, so a caller can only ever end their own Work Session
	// — no gate is needed, and this tracker already mounts on every page.
	useEffect(() => {
		const sendCloseBeacon = () => {
			try {
				navigator.sendBeacon(
					'/api/work-sessions/close',
					new Blob([JSON.stringify({ closedAt: new Date().toISOString() })], {
						type: 'application/json',
					})
				);
			} catch {}
		};

		window.addEventListener('pagehide', sendCloseBeacon);
		return () => window.removeEventListener('pagehide', sendCloseBeacon);
	}, []);

	// This component doesn't render anything visible
	return null;
}
