'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        // Check if user is already authenticated
        const res = await fetch('/api/session', { 
          credentials: 'include',
          cache: 'no-store'
        });
        const data = await res.json();
        
        if (data.authenticated && data.user) {
          // User is logged in, redirect based on role
          // Super admin goes to admin productivity dashboard
          if (data.user.is_super_admin) {
            router.push('/admin/productivity');
          } else {
            router.push('/dashboard');
          }
        } else {
          // User is not logged in, redirect to signin
          router.push('/signin');
        }
      } catch {
        // On error, redirect to signin
        router.push('/signin');
      } finally {
        setChecking(false);
      }
    };

    checkAuthAndRedirect();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        {checking ? (
          <>
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mb-4"></div>
            <p className="text-lg text-gray-600">Loading...</p>
          </>
        ) : (
          <p className="text-lg text-gray-600">Redirecting...</p>
        )}
      </div>
    </div>
  );
}
