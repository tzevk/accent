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
    let retryCount = 0;
    const maxRetries = 2;
    
    async function check() {
      // Allow public paths without check
      if (PUBLIC_PATHS.has(pathname)) {
        if (alive) setChecking(false);
        return;
      }

      try {
        const res = await fetch('/api/session', { 
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
        
        if (!res.ok) {
          // Retry once after a short delay if it's a transient error
          if (retryCount < maxRetries && (res.status === 500 || res.status === 503)) {
            retryCount++;
            console.log(`AuthGate: Session check failed (${res.status}), retrying (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 300));
            if (alive) check();
            return;
          }
          
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
        // Retry once on network errors
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`AuthGate: Session check error, retrying (${retryCount}/${maxRetries}):`, error.message);
          await new Promise(resolve => setTimeout(resolve, 300));
          if (alive) check();
          return;
        }
        
        console.log('AuthGate: Session check error after retries:', error);
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
