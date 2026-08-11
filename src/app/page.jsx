'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function Home() {
	const router = useRouter();
	const [checking, setChecking] = useState(true);

	useEffect(() => {
		// Middleware gates /: unauthenticated users are bounced to /signin
		// before this component renders. Authenticated users land here and
		// DashboardRedirect routes them by their session user.
		router.replace('/dashboard');
		setChecking(false);
	}, [router]);

	return (
		<LoadingSpinner
			message={checking ? 'Loading' : 'Redirecting'}
			subMessage="Please wait..."
		/>
	);
}
