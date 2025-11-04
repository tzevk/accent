'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const PUBLIC_PATHS = new Set([
  '/signin',
]);

export default function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    async function check() {
      // Allow public paths without check
      if (PUBLIC_PATHS.has(pathname)) {
        if (alive) setChecking(false);
        return;
      }

      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (!res.ok) {
          console.log('AuthGate: Session check failed with status:', res.status);
          const from = encodeURIComponent(pathname || '/');
          router.replace(`/signin?from=${from}`);
          return;
        }
        
        const data = await res.json();
        if (!data.authenticated) {
          console.log('AuthGate: User not authenticated');
          const from = encodeURIComponent(pathname || '/');
          router.replace(`/signin?from=${from}`);
          return;
        }
        
        console.log('AuthGate: Authentication successful for user:', data.user?.username);
      } catch (error) {
        console.log('AuthGate: Session check error:', error);
        const from = encodeURIComponent(pathname || '/');
        router.replace(`/signin?from=${from}`);
        return;
      } finally {
        if (alive) setChecking(false);
      }
    }
    check();
    return () => { alive = false };
  }, [pathname, router]);

  // While checking, avoid flashing protected content
  if (checking) return null;
  return null;
}
