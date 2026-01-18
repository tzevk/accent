'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSession } from '@/context/SessionContext';
import LoadingSpinner from '@/components/LoadingSpinner';

// Dynamic import to prevent any flash
const UserDashboardContent = dynamic(
  () => import('@/app/dashboard/user-dashboard'),
  { 
    ssr: false,
    loading: () => (
      <LoadingSpinner 
        message="Loading Dashboard" 
        subMessage="Preparing your workspace..." 
      />
    )
  }
);

/**
 * User Dashboard - Protected route
 * 
 * Uses SessionContext for consistent auth state.
 * AuthGate handles redirect to signin if not authenticated.
 */
export default function UserDashboardPage() {
  const router = useRouter();
  const { user, loading, authenticated } = useSession();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Wait for session to load
    if (loading) return;

    // Session loaded but not authenticated - check cookies as fallback
    if (!authenticated || !user) {
      const hasCookies = typeof document !== 'undefined' && 
        document.cookie.includes('auth=') && 
        document.cookie.includes('user_id=');
      
      if (hasCookies) {
        // Cookies exist - check if super admin
        const isSuperAdminCookie = document.cookie.includes('is_super_admin=1') || 
                                    document.cookie.includes('is_super_admin=true');
        if (isSuperAdminCookie) {
          router.replace('/admin/dashboard');
          return;
        }
        // Regular user with cookies - proceed
        setAuthorized(true);
        return;
      }
      // No cookies - let middleware handle redirect
      return;
    }

    // Super admin should go to admin dashboard
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;
    if (isSuperAdmin) {
      router.replace('/admin/dashboard');
      return;
    }

    // Regular user - authorized
    setAuthorized(true);
  }, [loading, authenticated, user, router]);

  // Show loader only while session is loading
  if (loading || !user || !authorized) {
    return (
      <LoadingSpinner 
        message="Loading Dashboard" 
        subMessage="Please wait..." 
      />
    );
  }

  // Render user dashboard
  return <UserDashboardContent verifiedUser={user} />;
}
