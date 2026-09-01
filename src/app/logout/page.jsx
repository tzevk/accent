'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function LogoutPage() {
	const router = useRouter();

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				await fetch('/api/logout', { method: 'POST', credentials: 'include' });
			} catch {
				// ignore network errors — still bounce to signin
			}
			if (!cancelled) router.replace('/signin');
		})();
		return () => {
			cancelled = true;
		};
	}, [router]);

	return <LoadingSpinner message="Signing out" subMessage="Please wait..." />;
}
