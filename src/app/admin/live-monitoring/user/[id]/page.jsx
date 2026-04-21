'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import UserDashboard from '@/app/dashboard/user-dashboard';

export default function LiveMonitoringUserPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();

  const userId = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  const isAdmin = useMemo(
    () => user && (user.is_super_admin || user.role?.code === 'admin'),
    [user]
  );

  const fetchUserDetails = async () => {
    if (!userId) return;

    setLoading(true);
    setError('');

    try {
      const statusRes = await fetch(`/api/user-status?user_id=${userId}`);
      const statusData = await statusRes.json();

      if (!statusData?.success) {
        throw new Error(statusData?.error || 'Failed to load user status');
      }

      // Add 'id' field matching the expected user object structure in UserDashboard
      const userData = statusData.data || null;
      if (userData && !userData.id) {
        userData.id = userId;
      }
      setSelectedUser(userData);

    } catch (err) {
      setError(err?.message || 'Failed to load user dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
      return;
    }

    if (!authLoading && isAdmin) {
      fetchUserDetails();
    }
  }, [authLoading, isAdmin, userId]);

  if (authLoading || loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  if (error || !selectedUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
        <Navbar />
        <main className="px-6 pt-24 pb-8 max-w-7xl mx-auto w-full">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error || 'User not found.'}
          </div>
          <button
            onClick={() => router.push('/admin/live-monitoring')}
            className="mt-4 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
          >
            ← Back to Live Monitoring
          </button>
        </main>
      </div>
    );
  }

  // Display the user's dashboard as it is
  return <UserDashboard verifiedUser={selectedUser} />;
}

