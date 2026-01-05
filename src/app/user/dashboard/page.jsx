'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { clearSessionCache } from '@/context/SessionContext';

// Dynamic import to prevent any flash
const UserDashboardContent = dynamic(
  () => import('@/app/dashboard/user-dashboard'),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    )
  }
);

/**
 * User Dashboard - Protected route
 * 
 * Protection: Never renders user dashboard UI until we confirm user is authenticated
 * - Initial state: checking = true (shows loader)
 * - Fetches /api/session to verify authentication
 * - If super admin → redirects to /admin/dashboard (they shouldn't be here)
 * - If not authenticated → redirects to /signin
 * - Only renders user dashboard once confirmed as regular user
 */
export default function UserDashboardPage() {
  const router = useRouter();
  
  // Protection state - starts as checking
  const [checking, setChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [sessionUser, setSessionUser] = useState(null);

  // Step 1: Check authorization FIRST before anything else
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Clear any stale session cache
        clearSessionCache();
        
        const response = await fetch('/api/session', {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });
        
        const data = await response.json();
        
        // Not authenticated
        if (!data.authenticated || !data.user) {
          router.replace('/signin');
          return;
        }
        
        // Check if super admin - they should be on admin dashboard
        const isSuperAdmin = data.user.is_super_admin === true || data.user.is_super_admin === 1;
        
        if (isSuperAdmin) {
          // Super admin should go to admin dashboard
          router.replace('/admin/dashboard');
          return;
        }
        
        // Regular user - authorized to be here
        // Store user data for passing to child component
        setSessionUser(data.user);
        setIsAuthorized(true);
        setChecking(false);
      } catch (error) {
        console.error('Auth check failed:', error);
        router.replace('/signin');
      }
    };

    checkAuth();
  }, [router]);

  // PROTECTION: While checking, show ONLY loader - no dashboard UI
  if (checking || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  // Only render user dashboard UI after authorization is confirmed
  // Pass verified user to prevent stale context data issues
  return <UserDashboardContent verifiedUser={sessionUser} />;
}
