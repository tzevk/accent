'use client';

import type { ReactNode } from 'react';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';

/**
 * Salary data is payroll data, so both Salary Profiles routes require
 * payroll:read independently of the admin shell admission. The shell exception
 * only decides whether the page may render at all; this gate is the page's own
 * permission check, and every API call is still authorized on the server.
 */
export function SalaryProfileAccess({ children }: { children: ReactNode }) {
	const { loading, user, can } = useSessionRBAC();

	if (loading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
					<p role="status" className="text-sm text-gray-600">
						Checking payroll access…
					</p>
				</div>
			</div>
		);
	}

	const allowed = Boolean(user?.is_super_admin) || can('payroll', 'read');
	if (!allowed) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
					<section
						role="alert"
						aria-labelledby="salary-access-denied"
						className="max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm"
					>
						<h1
							id="salary-access-denied"
							className="text-lg font-semibold text-gray-900"
						>
							Access denied
						</h1>
						<p className="mt-2 text-sm text-gray-700">
							Salary Profiles require the payroll read permission. Employee
							access alone does not reveal salary data.
						</p>
						<p className="mt-3 text-sm text-gray-500">
							Required permission:{' '}
							<span className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
								payroll:read
							</span>
						</p>
					</section>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
