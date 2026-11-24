'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useSession } from '@/context/SessionContext';

/**
 * Activity Tracker Component
 * Automatically tracks all user activity when mounted
 */
export default function ActivityTracker() {
	const { authenticated } = useSession();
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
	// own Work Session when an authenticated tab or window goes away without a
	// Sign out. `pagehide` fires on a real unload (tab close, window close,
	// navigating away) and never on in-app client navigation, so moving around
	// the app keeps the session open. The auth dependency removes the listener
	// as soon as the Session is lost. The endpoint still authorizes the caller.
	useEffect(() => {
		if (!authenticated) return;

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
	}, [authenticated]);

	// This component doesn't render anything visible
	return null;
}
