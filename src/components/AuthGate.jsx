'use client';

/**
 * AuthGate Component
 * 
 * Authentication is now handled entirely by middleware.
 * This component is kept as a no-op for backward compatibility.
 * 
 * Middleware (middleware.ts) is the single source of truth for:
 * - Redirecting unauthenticated users to /signin
 * - Redirecting authenticated users away from /signin
 * - Protecting admin routes from non-admin users
 */
export default function AuthGate() {
  // No-op - middleware handles all auth redirects
  return null;
}
