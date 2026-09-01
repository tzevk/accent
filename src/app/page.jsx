'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useSession } from '@/context/SessionContext';

export default function Home() {
	const router = useRouter();
	const { loading, authenticated } = useSession();

	useEffect(() => {
		if (loading) return;
		if (!authenticated) {
			router.replace('/signin');
		} else {
			router.replace('/dashboard');
		}
	}, [router, loading, authenticated]);

	return (
		<LoadingSpinner
			message={loading ? 'Loading' : 'Redirecting'}
			subMessage="Please wait..."
		/>
	);
}
