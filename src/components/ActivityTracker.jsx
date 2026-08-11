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

	// This component doesn't render anything visible
	return null;
}
