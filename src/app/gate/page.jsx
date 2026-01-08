'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';

/**
 * Gate Route - Intermediate authentication checkpoint
 * 
 * Uses SessionContext to avoid duplicate API calls.
 * The session is already being fetched by SessionContext,
 * so we just wait for it and redirect based on role.
 */
export default function GatePage() {
  const router = useRouter();
  const { user, loading, authenticated } = useSession();

  useEffect(() => {
    // Wait for session to load
    if (loading) return;

    // Not authenticated - redirect to signin
    if (!authenticated || !user) {
      router.replace('/signin');
      return;
    }

    // Check if super admin
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;

    if (isSuperAdmin) {
      // Super admin goes to admin dashboard
      router.replace('/admin/dashboard');
    } else {
      // Regular users go to user dashboard
      router.replace('/user/dashboard');
    }
  }, [loading, authenticated, user, router]);

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
