'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';

const SessionContext = createContext({
  user: null,
  loading: true,
  authenticated: false,
  can: () => false,
  refreshSession: () => {},
  RESOURCES,
  PERMISSIONS
});

// Cache session data in memory to prevent multiple fetches
let sessionCache = null;
let sessionCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const fetchSession = useCallback(async (force = false) => {
    // Return cached data if still valid and not forcing refresh
    const now = Date.now();
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
        sessionCache = { authenticated: false, user: null };
        sessionCacheTime = now;
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

      if (mountedRef.current) {
        setUser(data.user || null);
        setAuthenticated(data.authenticated || false);
      }

      return sessionCache;
    } catch (error) {
      console.error('Session fetch error:', error);
      sessionCache = { authenticated: false, user: null };
      sessionCacheTime = now;
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
        return hasPermission(user, resource, permission);
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
    RESOURCES,
    PERMISSIONS
  }), [user, loading, authenticated, can, refreshSession]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

// Clear session cache (call on logout)
export function clearSessionCache() {
  sessionCache = null;
  sessionCacheTime = 0;
}
