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
 */
export default function DashboardRedirect() {
  const router = useRouter();
  const { user, loading, authenticated } = useSession();

  useEffect(() => {
    // Wait for session to load
    if (loading) return;

    // Not authenticated - AuthGate will handle redirect
    if (!authenticated || !user) return;

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
