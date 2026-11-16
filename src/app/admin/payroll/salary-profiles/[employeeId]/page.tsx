'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { SalaryProfileAccess } from '@/components/salary-profiles/SalaryProfileAccess';
import { SalaryProfileEditor } from '@/components/salary-profiles/SalaryProfileEditor';

function SalaryProfileRoute() {
	const params = useParams<{ employeeId: string }>();
	const searchParams = useSearchParams();
	const employeeId = Number(params?.employeeId);
	const date = searchParams.get('date') ?? undefined;

	return (
		<SalaryProfileAccess>
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<SalaryProfileEditor employeeId={employeeId} initialDate={date} />
			</div>
		</SalaryProfileAccess>
	);
}

function SalaryProfileFallback() {
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<p role="status" className="text-sm text-gray-600">
					Loading salary profile…
				</p>
			</div>
		</div>
	);
}

/**
 * Full-page Salary Profile editor. useParams reads the Employee id on the
 * client, matching the existing Payroll Slip detail route.
 */
export default function SalaryProfileEditorPage() {
	return (
		<Suspense fallback={<SalaryProfileFallback />}>
			<SalaryProfileRoute />
		</Suspense>
	);
}
