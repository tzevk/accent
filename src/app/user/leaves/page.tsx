'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import LeaveApplications from '@/components/LeaveApplications';
import { useSession } from '@/context/SessionContext';
import LoadingSpinner from '@/components/LoadingSpinner';

/**
 * My Leaves — full leave management for the signed-in user.
 * Reached from the dashboard's Leaves stat tile.
 */
export default function UserLeavesPage() {
	const router = useRouter();
	const session = useSession() as {
		loading: boolean;
		authenticated: boolean;
	};

	// Session gate — proxy.ts checks cookie presence only.
	useEffect(() => {
		if (!session.loading && !session.authenticated) {
			router.replace('/signin');
		}
	}, [session.loading, session.authenticated, router]);

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="flex pt-2 sm:pl-16">
				<div className="flex-1 min-w-0">
					<div className="pl-0 pr-1 sm:pl-0.5 sm:pr-1.5 lg:pl-1 lg:pr-2 py-2 max-w-6xl mx-auto w-full">
						<button
							type="button"
							onClick={() => router.push('/user/dashboard')}
							className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#64126D] transition-colors rounded-md px-1.5 py-1 -ml-1.5 mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40"
						>
							<ArrowLeftIcon className="h-4 w-4" aria-hidden />
							Back to Dashboard
						</button>

						{session.loading ? (
							<LoadingSpinner
								message="Loading your leaves"
								subMessage="Fetching balances and applications…"
								showTimer={false}
								fullScreen={false}
								size="md"
							/>
						) : (
							<div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-3 sm:p-4 xl:p-5">
								<LeaveApplications />
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
