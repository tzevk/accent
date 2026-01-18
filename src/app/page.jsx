'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check cookies directly first - faster than API call
    const hasCookies = document.cookie.includes('auth=') && document.cookie.includes('user_id=');
    
    if (hasCookies) {
      // User has auth cookies - redirect based on is_super_admin cookie
      const isSuperAdmin = document.cookie.includes('is_super_admin=1') || 
                           document.cookie.includes('is_super_admin=true');
      router.replace(isSuperAdmin ? '/admin/productivity' : '/dashboard');
      setChecking(false);
      return;
    }
    
    // No cookies - redirect to signin immediately
    router.replace('/signin');
    setChecking(false);
  }, [router]);

  return (
    <LoadingSpinner 
      message={checking ? 'Loading' : 'Redirecting'} 
      subMessage="Please wait..." 
    />
  );
}
