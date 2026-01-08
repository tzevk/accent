'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';

const PUBLIC_PATHS = new Set([
  '/signin',
]);

export default function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, authenticated } = useSession();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    // Allow public paths without check
    if (PUBLIC_PATHS.has(pathname)) {
      return;
    }

    // Wait for session to load
    if (loading) {
      return;
    }

    // Redirect to signin if not authenticated
    if (!authenticated && !redirecting) {
      setRedirecting(true);
      const from = encodeURIComponent(pathname || '/');
      router.replace(`/signin?from=${from}`);
    }
  }, [pathname, loading, authenticated, router, redirecting]);

  return null;
}
