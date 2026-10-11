'use client';

import { usePathname } from 'next/navigation';

/**
 * The routes that render the dashboard — the one surface that owns this
 * page's main landmark. It is listed here rather than assumed so the link
 * is never rendered on a page whose content it cannot reach.
 */
const DASHBOARD_ROUTES = ['/user/dashboard', '/admin/live-monitoring/user'];

/**
 * The page's first focusable element. The root layout mounts it before the
 * sidebar and the navigation, so a keyboard user reaches the dashboard
 * content without walking the chrome first, and a screen-reader user can
 * jump straight to the main landmark.
 *
 * It is one link for the whole app: no page adds a second skip link, and
 * pages that render their own landmarks provide their own way in.
 */
export default function SkipToMainLink() {
	const pathname = usePathname() || '';
	const onDashboard = DASHBOARD_ROUTES.some((route) =>
		pathname.startsWith(route)
	);
	if (!onDashboard) return null;

	return (
		<a href="#main-content" className="skip-link">
			Skip to main content
		</a>
	);
}
