'use client';

import { useEffect, useState, useMemo } from 'react';
import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';

export function useSessionRBAC() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setUser(data.user || null);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false };
  }, []);

  const can = useMemo(() => {
    return (resource, permission) => {
      if (!user) return false;
      try {
        return hasPermission(user, resource, permission);
      } catch {
        return false;
      }
    }
  }, [user]);

  return { loading, user, can, RESOURCES, PERMISSIONS };
}
