'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { checkPermission, RESOURCES, PERMISSIONS } from '@/utils/permissions';

const SessionContext = createContext({
  user: null,
  loading: true,
  authenticated: false,
  can: () => false,
  refreshSession: () => {},
  setUserData: () => {},  // New: direct setter for login
  RESOURCES,
  PERMISSIONS
});

// Cache session data in memory to prevent multiple fetches
let sessionCache = null;
let sessionCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

// Flag to force next fetch to bypass cache
let forceNextFetch = false;

// Callback to update provider state from outside (set by provider)
let updateProviderState = null;

// Hydrate memory cache from sessionStorage on module load (survives refresh)
function hydrateFromStorage() {
  if (typeof window === 'undefined') return;
  try {
    const stored = sessionStorage.getItem('_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.authenticated && parsed?.user) {
        sessionCache = { authenticated: true, user: parsed.user };
        sessionCacheTime = Date.now(); // treat as fresh
      }
    }
  } catch {}
}
hydrateFromStorage();

// Persist session to sessionStorage
function persistToStorage(data) {
  if (typeof window === 'undefined') return;
  try {
    if (data?.authenticated && data?.user) {
      sessionStorage.setItem('_session', JSON.stringify({ authenticated: true, user: data.user }));
    } else {
      sessionStorage.removeItem('_session');
    }
  } catch {}
}

export function SessionProvider({ children }) {
  // Always start with loading=true to match server render and avoid hydration mismatch.
  // Cache is synced after mount via useEffect below.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  // After hydration, immediately sync from in-memory/sessionStorage cache
  // so pages that already had a session skip the loading flash.
  useEffect(() => {
    if (sessionCache?.authenticated && sessionCache?.user) {
      setUser(sessionCache.user);
      setAuthenticated(true);
      setLoading(false);
    }
  }, []);

  // Register the state updater so setSessionData can update state
  useEffect(() => {
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

  // Direct setter for login - updates state immediately
  const setUserData = useCallback((userData) => {
    if (userData) {
      sessionCache = {
        authenticated: true,
        user: userData
      };
      sessionCacheTime = Date.now();
      forceNextFetch = false;
      persistToStorage(sessionCache);
      setUser(userData);
      setAuthenticated(true);
      setLoading(false);
    }
  }, []);

  const fetchSession = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Check if we need to force fetch (cache was invalidated)
    if (forceNextFetch) {
      force = true;
      forceNextFetch = false;
    }
    
    // Clear cache when forcing refresh
    if (force) {
      sessionCache = null;
      sessionCacheTime = 0;
    }
    
    // Return cached data if still valid and not forcing refresh
    if (!force && sessionCache && (now - sessionCacheTime) < CACHE_TTL) {
      if (mountedRef.current) {
        setUser(sessionCache.user);
        setAuthenticated(sessionCache.authenticated);
        setLoading(false);
      }
      return sessionCache;
    }

    // Prevent concurrent fetches
    if (fetchingRef.current) {
      return sessionCache;
    }

    fetchingRef.current = true;

    try {
      const res = await fetch('/api/session', { 
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!res.ok) {
        // On 401, check if we have cookies as a fallback
        // This handles the race condition where cookies are set but /api/session hasn't seen them yet
        const hasCookies = typeof document !== 'undefined' && 
          document.cookie.includes('auth=') && 
          document.cookie.includes('user_id=');
        
        if (hasCookies) {
          // Cookies exist but session API failed - retry once after short delay
          await new Promise(r => setTimeout(r, 100));
          const retryRes = await fetch('/api/session', { credentials: 'include' });
          if (retryRes.ok) {
            const data = await retryRes.json();
            sessionCache = { authenticated: data.authenticated || false, user: data.user || null };
            sessionCacheTime = Date.now();
            persistToStorage(sessionCache);
            if (mountedRef.current) {
              setUser(data.user || null);
              setAuthenticated(data.authenticated || false);
            }
            return sessionCache;
          }
        }
        
        sessionCache = { authenticated: false, user: null };
        sessionCacheTime = now;
        persistToStorage(sessionCache);
        if (mountedRef.current) {
          setUser(null);
          setAuthenticated(false);
        }
        return sessionCache;
      }

      const data = await res.json();
      sessionCache = {
        authenticated: data.authenticated || false,
        user: data.user || null
      };
      sessionCacheTime = now;
      persistToStorage(sessionCache);

      if (mountedRef.current) {
        setUser(data.user || null);
        setAuthenticated(data.authenticated || false);
      }

      return sessionCache;
    } catch (error) {
      console.error('Session fetch error:', error);
      sessionCache = { authenticated: false, user: null };
      sessionCacheTime = now;
      persistToStorage(sessionCache);
      if (mountedRef.current) {
        setUser(null);
        setAuthenticated(false);
      }
      return sessionCache;
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

  const value = useMemo(() => ({
    user,
    loading,
    authenticated,
    can,
    refreshSession,
    setUserData,
    RESOURCES,
    PERMISSIONS
  }), [user, loading, authenticated, can, refreshSession, setUserData]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

// Clear session cache - next fetch will get fresh data
export function clearSessionCache() {
  sessionCache = null;
  sessionCacheTime = 0;
  forceNextFetch = true;
  persistToStorage(null);
}

// Pre-set session data (used after login to avoid refetch delay)
export function setSessionData(userData) {
  if (userData) {
    sessionCache = {
      authenticated: true,
      user: userData
    };
    sessionCacheTime = Date.now();
    forceNextFetch = false;
    persistToStorage(sessionCache);
    
    // Also update the provider state if it's mounted
    if (updateProviderState) {
      updateProviderState(userData);
    }
  }
}
