'use client';

/**
 * AuthGate Component
 *
 * Authentication is now handled entirely by proxy.
 * This component is kept as a no-op for backward compatibility.
 *
 * Proxy (proxy.ts) is the single source of truth for:
 * - Redirecting unauthenticated users to /signin
 * - Redirecting authenticated users away from /signin
 * - Protecting admin routes from non-admin users
 */
export default function AuthGate() {
	// No-op - proxy handles all auth redirects
	return null;
}
