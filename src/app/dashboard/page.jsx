'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';

/**
 * Dashboard Route - Redirector
 * 
 * This route redirects to the appropriate protected dashboard route:
 * - Super admins → /admin/dashboard (protected)
 * - Regular users → /user/dashboard (protected)
 * 
 * Uses SessionContext for consistent auth state.
 * Falls back to cookies if session not yet loaded.
 */
export default function DashboardRedirect() {
  const router = useRouter();
  const { user, loading, authenticated } = useSession();

  useEffect(() => {
    // Wait for session to load
    if (loading) return;

    // Session loaded but not authenticated - check cookies as fallback
    if (!authenticated || !user) {
      const hasCookies = typeof document !== 'undefined' && 
        document.cookie.includes('auth=') && 
        document.cookie.includes('user_id=');
      
      if (hasCookies) {
        // Redirect based on is_super_admin cookie
        const isSuperAdmin = document.cookie.includes('is_super_admin=1') || 
                             document.cookie.includes('is_super_admin=true');
        router.replace(isSuperAdmin ? '/admin/dashboard' : '/user/dashboard');
        return;
      }
      // No cookies - let middleware handle redirect to signin
      return;
    }

    // Redirect based on user type
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;
    
    if (isSuperAdmin) {
      router.replace('/admin/dashboard');
    } else {
      router.replace('/user/dashboard');
    }
  }, [loading, authenticated, user, router]);

  // Always show only a neutral loader - never any dashboard UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-200 border-t-purple-600"></div>
        </div>
        <div className="text-gray-600 font-medium">Loading dashboard...</div>
      </div>
    </div>
  );
}
