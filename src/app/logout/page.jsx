'use client';

import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { logout } from '@/lib/logout';

export default function LogoutPage() {
	const [error, setError] = useState('');

	const signOut = useCallback(
		() =>
			logout().then((outcome) => {
				if (outcome.status === 'failed') setError(outcome.message);
			}),
		[]
	);

	const retry = () => {
		setError('');
		void signOut();
	};

	useEffect(() => {
		void signOut();
	}, [signOut]);

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<div role="alert" className="max-w-md text-center">
					<h1 className="text-lg font-semibold text-gray-900">
						Could not sign you out
					</h1>
					<p className="mt-1 text-sm text-gray-600">{error}</p>
					<button
						type="button"
						onClick={retry}
						className="mt-4 rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white hover:bg-[#52105a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
					>
						Try again
					</button>
				</div>
			</div>
		);
	}

	return <LoadingSpinner message="Signing out" subMessage="Please wait..." />;
}
