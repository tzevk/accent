'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';

const PUBLIC_PATH_PREFIXES = [
	'/signin',
	'/_next',
	'/api',
	'/favicon.ico',
	'/robots.txt',
	'/sitemap.xml',
	'/manifest.webmanifest',
	'/accent-logo.png',
	'/uploads',
];

function isPublicPath(pathname) {
	if (!pathname) return false;
	return PUBLIC_PATH_PREFIXES.some(
		(p) => pathname === p || pathname.startsWith(p + '/')
	);
}

/**
 * AuthGate — client-side fallback for proxy auth
 *
 * proxy.ts is the primary gate (cookie presence → redirect). This component
 * covers the two cases proxy can't:
 * 1. Stale/expired session cookie present (proxy sees cookie → lets through,
 *    but /api/session → {authenticated:false}). Without this, the page shell
 *    renders blank with "no data" instead of bouncing to /signin.
 * 2. Any route proxy's matcher missed (never expected, but defence in depth).
 *
 * Mirrors proxy's public-path list so /signin never loops.
 */
export default function AuthGate() {
	const router = useRouter();
	const pathname = usePathname();
	const { loading, authenticated } = useSession();

	useEffect(() => {
		if (loading) return;
		// Public pages — never redirect
		if (isPublicPath(pathname)) {
			// Authenticated user stuck on /signin → send to dashboard (proxy
			// already does this on hard nav, this covers SPA nav + stale cookie).
			if (pathname === '/signin' && authenticated) {
				router.replace('/dashboard');
			}
			return;
		}

		if (!authenticated) {
			const from = encodeURIComponent(pathname || '/');
			router.replace(`/signin?from=${from}`);
		}
	}, [pathname, loading, authenticated, router]);

	return null;
}
