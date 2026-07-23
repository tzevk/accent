'use client';

import {
	createContext,
	useContext,
	useEffect,
	useState,
	useMemo,
	useCallback,
	useRef,
} from 'react';
import { usePathname } from 'next/navigation';
import { checkPermission, RESOURCES, PERMISSIONS } from '@/utils/permissions';

const SessionContext = createContext({
	user: null,
	loading: true,
	authenticated: false,
	can: () => false,
	refreshSession: () => {},
	setUserData: () => {}, // New: direct setter for login
	RESOURCES,
	PERMISSIONS,
});

// Flag to force next fetch to bypass cache
let forceNextFetch = false;

// Callback to update provider state from outside (set by provider)
let updateProviderState = null;

export function SessionProvider({ children }) {
	// Always start with loading=true to match server render and avoid hydration mismatch.
	// Cache is synced after mount via useEffect below.
	const [user, setUser] = useState(null);
	const [loading, setLoading] = useState(true);
	const [authenticated, setAuthenticated] = useState(false);
	const fetchingRef = useRef(false);
	const mountedRef = useRef(true);
	const pathname = usePathname();

	// After hydration, start loading immediately — no cache to sync from
	useEffect(() => {
		// Register the state updater so setSessionData can update state
		updateProviderState = (userData) => {
			if (userData) {
				setUser(userData);
				setAuthenticated(true);
				setLoading(false);
			}
		};
		return () => {
			updateProviderState = null;
		};
	}, []);

	// Direct setter for login - updates state immediately (no caching)
	const setUserData = useCallback((userData) => {
		if (userData) {
			setUser(userData);
			setAuthenticated(true);
			setLoading(false);
		}
	}, []);

	// Always fetch session from server — no client-side cache
	const fetchSession = useCallback(async (_force = false) => {
		const hasAuthCookies = () => {
			try {
				return (
					typeof document !== 'undefined' &&
					document.cookie.includes('auth=') &&
					document.cookie.includes('user_id=')
				);
			} catch {
				return false;
			}
		};

		// Prevent concurrent fetches
		if (fetchingRef.current) return;
		fetchingRef.current = true;

		try {
			const res = await fetch('/api/session', {
				credentials: 'include',
			});

			if (!res.ok) {
				const status = res.status;
				const hasCookies = hasAuthCookies();

				if (status === 401) {
					// Cookies exist but session API failed - retry once
					if (hasCookies) {
						await new Promise((r) => setTimeout(r, 100));
						const retryRes = await fetch('/api/session', {
							credentials: 'include',
						});
						if (retryRes.ok) {
							const data = await retryRes.json();
							if (mountedRef.current) {
								setUser(data.user || null);
								setAuthenticated(data.authenticated || false);
							}
							return;
						}
					}

					// Real 401 — user is logged out
					if (mountedRef.current) {
						setUser(null);
						setAuthenticated(false);
					}
					return;
				}

				// Non-401 error — keep current state, don't log out
				return;
			}

			const data = await res.json();
			if (mountedRef.current) {
				setUser(data.user || null);
				setAuthenticated(data.authenticated || false);
			}
		} catch (error) {
			console.error('Session fetch error:', error);
			// Network error — keep current state, don't log out
		} finally {
			fetchingRef.current = false;
			if (mountedRef.current) {
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		fetchSession();
		return () => {
			mountedRef.current = false;
		};
	}, [fetchSession]);

	// Re-fetch session on every SPA route change so permissions are fresh
	// after navigating (covers admin saving permissions in another tab).
	const pathRef = useRef(pathname);
	useEffect(() => {
		if (pathname !== pathRef.current) {
			pathRef.current = pathname;
			fetchSession();
		}
	}, [pathname, fetchSession]);

	// Re-fetch session when the tab becomes visible (user switches back
	// after an admin changed their permissions in another tab).
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				fetchSession();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, [fetchSession]);

	const can = useMemo(() => {
		return (resource, permission) => {
			if (!user) return false;
			try {
				return checkPermission(user, resource, permission);
			} catch {
				return false;
			}
		};
	}, [user]);

	const refreshSession = useCallback(() => {
		return fetchSession(true);
	}, [fetchSession]);

	const value = useMemo(
		() => ({
			user,
			loading,
			authenticated,
			can,
			refreshSession,
			setUserData,
			RESOURCES,
			PERMISSIONS,
		}),
		[user, loading, authenticated, can, refreshSession, setUserData]
	);

	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession() {
	return useContext(SessionContext);
}

// Force next session fetch to hit the server
export function clearSessionCache() {
	forceNextFetch = true;
}

// Pre-set session data (used after login to avoid refetch delay)
export function setSessionData(userData) {
	if (userData) {
		// Update the provider state if it's mounted
		if (updateProviderState) {
			updateProviderState(userData);
		}
	}
}
