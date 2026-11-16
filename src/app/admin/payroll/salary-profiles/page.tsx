'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { SalaryProfileAccess } from '@/components/salary-profiles/SalaryProfileAccess';
import { SalaryProfileList } from '@/components/salary-profiles/SalaryProfileList';
import type { SalaryDirectoryFilter } from '@/lib/salary-profile-directory';

type StreamFilter = SalaryDirectoryFilter | 'all';

function streamFromParam(value: string | null): StreamFilter {
	return value === 'payroll' || value === 'contract' || value === 'missing'
		? value
		: 'all';
}

function SalaryProfilesRoute() {
	const searchParams = useSearchParams();
	const stream = streamFromParam(searchParams.get('stream'));
	const date = searchParams.get('date') ?? undefined;

	return (
		<SalaryProfileAccess>
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<SalaryProfileList initialStream={stream} initialDate={date} />
			</div>
		</SalaryProfileAccess>
	);
}

function SalaryProfilesFallback() {
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<p role="status" className="text-sm text-gray-600">
					Loading Salary Profiles…
				</p>
			</div>
		</div>
	);
}

/**
 * Payroll → Salary Profiles directory. The URL may preselect a Payroll,
 * Contract or Missing Profile view from the shared navigation (#445), and the
 * selected as-of date carries into the employee editor.
 */
export default function SalaryProfilesPage() {
	return (
		<Suspense fallback={<SalaryProfilesFallback />}>
			<SalaryProfilesRoute />
		</Suspense>
	);
}
