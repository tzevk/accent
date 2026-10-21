'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import LeadCreateForm from '@/components/leads/LeadCreateForm';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	RESOURCES as RBAC_RESOURCES,
	PERMISSIONS as RBAC_PERMISSIONS,
} from '@/utils/rbac';
import { useCompanyDirectory } from '@/components/leads/queries';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

interface SessionUserShape {
	full_name?: unknown;
}

function LoadingFallback() {
	return (
		<div className="h-[calc(100vh-4rem)] bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-1 flex items-center justify-center">
				<LoadingSpinner
					message="Loading"
					subMessage="Preparing lead form..."
					showTimer={false}
					fullScreen={false}
					size="md"
				/>
			</div>
		</div>
	);
}

/**
 * Standalone create page. It reuses the same shared create form as the leads
 * tab so both entry points keep one vocabulary and one ownership default.
 */
function NewLeadForm() {
	const router = useRouter();
	const { loading: rbacLoading, user, can } = useSessionRBAC();
	const canCreate =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.CREATE);
	const canAssign =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.ASSIGN);
	const sessionUser = user as SessionUserShape | null;
	const creatorLabel =
		sessionUser && typeof sessionUser.full_name === 'string'
			? sessionUser.full_name
			: null;
	const companiesQuery = useCompanyDirectory(canCreate);
	const companies = companiesQuery.data?.data ?? [];

	if (rbacLoading) return <LoadingFallback />;

	return (
		<div className="h-[calc(100vh-4rem)] bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-1 overflow-hidden">
				<div className="h-full overflow-y-auto">
					<div className="px-6 lg:px-8 xl:px-12 2xl:px-16 pt-6 pb-8 max-w-[1800px] mx-auto w-full">
						<div className="mb-8 flex items-center gap-4">
							<button
								type="button"
								onClick={() => router.back()}
								aria-label="Go back"
								className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
							>
								<ArrowLeftIcon className="h-5 w-5" />
							</button>
							<div>
								<h1 className="text-3xl font-bold text-gray-900">
									Add New Lead
								</h1>
								<p className="text-gray-600">
									Create a new lead. It starts at New with the creator as owner.
								</p>
							</div>
						</div>
						<div className="max-w-4xl">
							{canCreate ? (
								<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
									<LeadCreateForm
										companies={companies}
										creatorLabel={creatorLabel}
										canAssign={canAssign}
										onCreated={() => router.push('/leads')}
										onCancel={() => router.back()}
									/>
								</div>
							) : (
								<p className="text-sm text-gray-600">
									You do not have permission to create leads.
								</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function NewLeadPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<NewLeadForm />
		</Suspense>
	);
}
