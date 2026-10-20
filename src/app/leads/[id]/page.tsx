'use client';

import Navbar from '@/components/Navbar';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	RESOURCES as RBAC_RESOURCES,
	PERMISSIONS as RBAC_PERMISSIONS,
} from '@/utils/rbac';
import { apiDelete } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import LeadStageBadge from '@/components/leads/LeadStageBadge';
import LegacyReviewPanel from '@/components/leads/LegacyReviewPanel';
import DuplicateReview from '@/components/leads/DuplicateReview';
import OwnershipHistory from '@/components/leads/OwnershipHistory';
import LeadAssignForm from '@/components/leads/LeadAssignForm';
import LeadActivityForm from '@/components/leads/LeadActivityForm';
import LeadLifecycleActions from '@/components/leads/LeadLifecycleActions';
import LeadConversionAction from '@/components/leads/LeadConversionAction';
import LeadProposalProgressPanel from '@/components/leads/LeadProposalProgress';
import LeadTimeline from '@/components/leads/LeadTimeline';
import {
	leadKeys,
	useLeadDetail,
	useLeadOwners,
} from '@/components/leads/queries';
import {
	ArrowLeftIcon,
	PencilIcon,
	TrashIcon,
	PhoneIcon,
	EnvelopeIcon,
	MapPinIcon,
	CalendarIcon,
	FlagIcon,
	UserIcon,
	BuildingOfficeIcon,
	DocumentTextIcon,
} from '@heroicons/react/24/outline';

interface LeadDetailsProps {
	params: Promise<{ id: string }>;
}

const PRIORITY_TONES: Record<string, string> = {
	high: 'text-red-600',
	medium: 'text-yellow-600',
	low: 'text-green-600',
};

/**
 * Lead detail workspace. The client performs no proposal creation here, and
 * stage authority stays with the server workflow.
 */
export default function LeadDetails({ params }: LeadDetailsProps) {
	const { id } = use(params);
	const router = useRouter();
	const queryClient = useQueryClient();
	const { loading: rbacLoading, can } = useSessionRBAC();
	const canView =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.READ);
	const canEdit =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.UPDATE);
	const canDelete =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.DELETE);
	const canAssign =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.ASSIGN);
	// The canonical Proposal decision needs the Lead update right and the
	// right to read the Proposals the decision is made between.
	const canReviewProposal =
		canEdit && can(RBAC_RESOURCES.PROPOSALS, RBAC_PERMISSIONS.READ);
	// The handoff needs the Lead convert right, the Lead update right, and
	// the right to create Proposals. The server checks the same three.
	const canConvert =
		canEdit &&
		can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.CONVERT) &&
		can(RBAC_RESOURCES.PROPOSALS, RBAC_PERMISSIONS.CREATE);
	const detailQuery = useLeadDetail(id, canView);
	const ownersQuery = useLeadOwners(!rbacLoading && canAssign);
	const deleteMutation = useMutation<{ success: boolean }, Error, void>({
		mutationFn: () => apiDelete(`/api/leads/${id}`),
		onSuccess: () => {
			alert('Lead deleted successfully!');
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			router.push('/leads');
		},
		onError: (error) => {
			alert('Error deleting lead: ' + error.message);
		},
	});

	const lead = detailQuery.data?.data ?? null;
	const loading = detailQuery.isPending;
	const loadError =
		detailQuery.error instanceof Error ? detailQuery.error.message : null;
	const ownerNames: Record<number, string> = {};
	for (const row of ownersQuery.data?.data ?? []) {
		ownerNames[row.id] = row.full_name;
	}

	const handleDelete = (): void => {
		if (!lead) return;
		if (
			window.confirm(
				`Are you sure you want to delete this lead from "${lead.company_name ?? 'this company'}"? This will mark it as deleted.`
			)
		) {
			deleteMutation.mutate();
		}
	};

	if (loading) {
		return (
			<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
				<Navbar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center" role="status">
						<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
						<p className="mt-4 text-gray-600">Loading lead details...</p>
					</div>
				</div>
			</div>
		);
	}

	if (!lead || loadError) {
		return (
			<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
				<Navbar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<h2 className="text-xl font-semibold text-gray-900">
							{loadError
								? 'Lead details could not be loaded'
								: 'Lead not found'}
						</h2>
						<p className="mt-2 text-gray-600" role="alert">
							{loadError ?? "The lead you're looking for doesn't exist."}
						</p>
						<button
							type="button"
							onClick={() => router.push('/leads')}
							className="mt-4 bg-[#64126D] text-white px-4 py-2 rounded-md hover:bg-[#52105a]"
						>
							Back to Leads
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-1 overflow-hidden">
				<div className="h-full px-6 lg:px-8 xl:px-12 2xl:px-16 pt-22 max-w-[1800px] mx-auto w-full">
					<div className="mb-6 flex items-center justify-between">
						<div className="flex items-center space-x-4">
							<button
								type="button"
								onClick={() => router.back()}
								aria-label="Go back to leads"
								className="p-2 hover:bg-gray-100 rounded-full transition-colors"
							>
								<ArrowLeftIcon className="h-5 w-5 text-gray-600" />
							</button>
							<div>
								<h1 className="text-2xl font-bold text-gray-900">
									{lead.company_name}
								</h1>
								<p className="text-gray-600">Lead Details</p>
							</div>
						</div>
						<div className="flex space-x-3">
							{canEdit ? (
								<button
									type="button"
									onClick={() => router.push(`/leads/${lead.id}/edit`)}
									className="bg-[#64126D] text-white px-4 py-2 rounded-md hover:bg-[#52105a] flex items-center space-x-2"
								>
									<PencilIcon className="h-4 w-4" />
									<span>Edit</span>
								</button>
							) : null}
							{canDelete ? (
								<button
									type="button"
									onClick={handleDelete}
									disabled={deleteMutation.isPending}
									className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center space-x-2"
								>
									<TrashIcon className="h-4 w-4" />
									<span>Delete</span>
								</button>
							) : null}
						</div>
					</div>

					<div className="h-full overflow-y-auto pb-8">
						<div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl">
							<div className="xl:col-span-2 space-y-6">
								<LegacyReviewPanel
									lead={lead}
									owners={ownersQuery.data?.data ?? []}
									canReviewStage={canEdit}
									canReviewOwner={canAssign}
									canReviewProposal={canReviewProposal}
								/>
								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
										<BuildingOfficeIcon className="h-5 w-5 mr-2 text-gray-500" />
										Company & Contact Information
									</h3>
									<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Company Name
											</p>
											<p className="text-sm text-gray-900">
												{lead.company_name || 'N/A'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Contact Person
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<UserIcon className="h-4 w-4 mr-1 text-gray-400" />
												{lead.contact_name || 'N/A'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Contact Email
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<EnvelopeIcon className="h-4 w-4 mr-1 text-gray-400" />
												{lead.contact_email || 'N/A'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Phone
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<PhoneIcon className="h-4 w-4 mr-1 text-gray-400" />
												{lead.phone || 'N/A'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Location
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<MapPinIcon className="h-4 w-4 mr-1 text-gray-400" />
												{lead.city || 'N/A'}
											</p>
										</div>
										<div className="lg:col-span-2 xl:col-span-3">
											<p className="text-sm font-medium text-gray-700 mb-1">
												Inquiry Email
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<EnvelopeIcon className="h-4 w-4 mr-1 text-gray-400" />
												{lead.inquiry_email || 'N/A'}
											</p>
											<p className="text-xs text-gray-500 mt-0.5">
												Email ID of person from whom inquiry was received
											</p>
										</div>
										<div className="lg:col-span-2 xl:col-span-3">
											<p className="text-sm font-medium text-gray-700 mb-1">
												CC Emails
											</p>
											<p className="text-sm text-gray-900 flex items-start">
												<EnvelopeIcon className="h-4 w-4 mr-1 mt-0.5 text-gray-400 flex-shrink-0" />
												<span className="break-all">
													{lead.cc_emails || 'N/A'}
												</span>
											</p>
											<p className="text-xs text-gray-500 mt-0.5">
												Additional email IDs (comma-separated)
											</p>
										</div>
									</div>
								</div>

								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
										<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
										Project Details
									</h3>
									<div className="space-y-4">
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Project Description
											</p>
											<p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-md">
												{lead.project_description || 'No description provided'}
											</p>
										</div>
										<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
											<div>
												<p className="text-sm font-medium text-gray-700 mb-1">
													Enquiry Type
												</p>
												<p className="text-sm text-gray-900">
													{lead.enquiry_type || 'N/A'}
												</p>
											</div>
											<div>
												<p className="text-sm font-medium text-gray-700 mb-1">
													Lead Source
												</p>
												<p className="text-sm text-gray-900">
													{lead.lead_source || 'N/A'}
												</p>
											</div>
										</div>
										{lead.notes ? (
											<div>
												<p className="text-sm font-medium text-gray-700 mb-1">
													Notes
												</p>
												<p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-md">
													{lead.notes}
												</p>
											</div>
										) : null}
									</div>
								</div>

								<DuplicateReview lead={lead} />
								<OwnershipHistory
									history={lead.ownership_history ?? []}
									ownerNameById={ownerNames}
								/>
								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4">
										Log activity
									</h3>
									<LeadActivityForm
										leadId={String(lead.id)}
										canRecord={canEdit}
									/>
								</div>
								<LeadTimeline leadId={String(lead.id)} enabled={canView} />
							</div>

							<div className="space-y-6">
								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4">
										Stage & Priority
									</h3>
									<div className="space-y-4">
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Lead Stage
											</p>
											<LeadStageBadge stage={lead.enquiry_status} />
											{lead.enquiry_status === 'Converted' ? (
												<p className="mt-2 text-xs text-gray-500">
													Converted is recorded by the Proposal handoff, not a
													manual stage edit.
												</p>
											) : null}
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Priority
											</p>
											<p
												className={cn(
													'text-sm font-medium flex items-center',
													PRIORITY_TONES[lead.priority?.toLowerCase() ?? ''] ??
														'text-gray-600'
												)}
											>
												<FlagIcon className="h-4 w-4 mr-1" />
												{lead.priority?.toUpperCase() || 'N/A'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Enquiry Date
											</p>
											<p className="text-sm text-gray-900 flex items-center">
												<CalendarIcon className="h-4 w-4 mr-1 text-gray-400" />
												{formatDate(lead.enquiry_date)}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Next follow-up
											</p>
											<p className="text-sm text-gray-900">
												{formatDate(
													lead.next_action_date ?? lead.follow_up_date
												)}
											</p>
											<p className="text-xs text-gray-500 mt-0.5">
												{lead.enquiry_status === 'Converted'
													? 'The next action is on the Proposal'
													: lead.next_action_type
														? `Next action: ${lead.next_action_type}`
														: 'No next action scheduled'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Last successful contact
											</p>
											<p className="text-sm text-gray-900">
												{formatDateTime(lead.last_contact_at)}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Latest activity
											</p>
											<p className="text-sm text-gray-900">
												{formatDateTime(lead.latest_activity_at)}
											</p>
											<p className="text-xs text-gray-500 mt-0.5">
												{lead.latest_activity_outcome
													? `Latest outcome: ${lead.latest_activity_outcome}`
													: 'No outcome recorded yet'}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-gray-700 mb-1">
												Completed activities
											</p>
											<p className="text-sm text-gray-900">
												{lead.activity_count}
											</p>
										</div>
									</div>
								</div>

								<LeadProposalProgressPanel
									progress={lead.proposal_progress ?? null}
								/>

								<LeadLifecycleActions
									lead={lead}
									owners={ownersQuery.data?.data ?? []}
									canDecide={canEdit}
								/>

								<LeadConversionAction lead={lead} canConvert={canConvert} />

								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4">
										Lead Owner
									</h3>
									<p className="text-sm text-gray-900 mb-3">
										{lead.owner_name ?? 'Unassigned intake'}
									</p>
									<LeadAssignForm lead={lead} canAssign={canAssign} />
								</div>

								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4">
										Timeline
									</h3>
									<div className="space-y-3">
										<div className="flex justify-between items-center text-sm">
											<span className="text-gray-600">Created:</span>
											<span className="text-gray-900">
												{formatDate(lead.created_at)}
											</span>
										</div>
										{lead.updated_at && lead.updated_at !== lead.created_at ? (
											<div className="flex justify-between items-center text-sm">
												<span className="text-gray-600">Last Updated:</span>
												<span className="text-gray-900">
													{formatDate(lead.updated_at)}
												</span>
											</div>
										) : null}
									</div>
								</div>

								<div className="bg-white rounded-lg border border-gray-200 p-6">
									<h3 className="text-lg font-medium text-gray-900 mb-4">
										Lead Information
									</h3>
									<div className="space-y-3">
										<div className="flex justify-between items-center text-sm">
											<span className="text-gray-600">Lead ID:</span>
											<span className="text-gray-900 font-mono">
												#{lead.id}
											</span>
										</div>
										{lead.lead_id ? (
											<div className="flex justify-between items-center text-sm">
												<span className="text-gray-600">Lead number:</span>
												<span className="text-gray-900 font-mono">
													{lead.lead_id}
												</span>
											</div>
										) : null}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
