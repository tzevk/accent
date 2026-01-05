'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearSessionCache } from '@/context/SessionContext';

/**
 * Gate Route - Intermediate authentication checkpoint
 * 
 * This route acts as a "gate" after login to:
 * 1. Call a single endpoint to verify session and get user role
 * 2. Redirect to the appropriate dashboard based on role
 * 
 * Rule: Show ONLY a loader until we know exactly where to send the user
 */
export default function GatePage() {
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      try {
        // Clear any stale session cache first
        clearSessionCache();
        
        // Call single endpoint to get session info including is_super_admin
        const response = await fetch('/api/session', {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });
        
        const data = await response.json();
        
        // Not authenticated - redirect to signin
        if (!data.authenticated || !data.user) {
          router.replace('/signin');
          return;
        }
        
        // Check if super admin
        const isSuperAdmin = data.user.is_super_admin === true || data.user.is_super_admin === 1;
        
        if (isSuperAdmin) {
          // Super admin goes to admin dashboard
          router.replace('/admin/dashboard');
        } else {
          // Regular users go to user dashboard
          router.replace('/user/dashboard');
        }
      } catch (error) {
        console.error('Gate session check failed:', error);
        // On error, redirect to signin
        router.replace('/signin');
      }
    };

    checkSession();
  }, [router]);

  // Always show only a neutral loader - no dashboard UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-200 border-t-purple-600"></div>
        </div>
        <div className="text-gray-600 font-medium">Preparing your workspace...</div>
        <div className="text-gray-400 text-sm">Please wait</div>
      </div>
    </div>
  );
}
