'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	RESOURCES as RBAC_RESOURCES,
	PERMISSIONS as RBAC_PERMISSIONS,
} from '@/utils/rbac';
import { apiDelete } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { LEAD_STAGES } from '@/lib/lead-stages';
import { cn } from '@/lib/cn';
import LeadStageBadge from '@/components/leads/LeadStageBadge';
import LeadCreateForm from '@/components/leads/LeadCreateForm';
import LeadImportForm from '@/components/leads/LeadImportForm';
import OwnerSelect from '@/components/leads/OwnerSelect';
import {
	leadKeys,
	useCompanyDirectory,
	useLeadList,
} from '@/components/leads/queries';
import type { LeadListStats } from '@/components/leads/types';
import {
	PlusIcon,
	UserGroupIcon,
	PhoneIcon,
	EnvelopeIcon,
	ArrowRightIcon,
	ArrowLeftIcon,
	MagnifyingGlassIcon,
	DocumentTextIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	FunnelIcon,
	LockClosedIcon,
} from '@heroicons/react/24/outline';

const PAGE_SIZE = 20;
const EMPTY_STATS: LeadListStats = {
	total_leads: 0,
	unassigned_leads: 0,
	needs_review_leads: 0,
	stage_new: 0,
	stage_attempting_contact: 0,
	stage_connected: 0,
	stage_qualified: 0,
	stage_nurture: 0,
	stage_disqualified: 0,
	stage_converted: 0,
	stage_unresolved: 0,
};

type TabId = 'list' | 'add';

interface SessionUserShape {
	full_name?: unknown;
}

const PRIORITY_TONES: Record<string, string> = {
	high: 'text-red-500',
	medium: 'text-yellow-500',
	low: 'text-green-500',
};

export default function Leads() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { loading: rbacLoading, user, can } = useSessionRBAC();
	const canViewLeads =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.READ);
	const canCreate =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.CREATE);
	const canDelete =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.DELETE);
	const canUpdate =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.UPDATE);
	const canImport =
		!rbacLoading &&
		can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.IMPORT) &&
		can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.CREATE);
	const canAssign =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.ASSIGN);

	const [currentPage, setCurrentPage] = useState<number>(1);
	const [searchTerm, setSearchTerm] = useState<string>('');
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
	const [statusFilter, setStatusFilter] = useState<string>('');
	const [ownerFilter, setOwnerFilter] = useState<string>('');
	const [reviewOnly, setReviewOnly] = useState<boolean>(false);
	const [cityFilter, setCityFilter] = useState<string>('');
	const [sortBy, setSortBy] = useState<string>('enquiry_date');
	const [sortOrder, setSortOrder] = useState<string>('desc');
	const [activeTab, setActiveTab] = useState<TabId>('list');
	const [showImport, setShowImport] = useState<boolean>(false);
	const searchDebounceRef = useRef<number | undefined>(undefined);

	const listParams = useMemo<Record<string, string>>(
		() => ({
			page: String(currentPage),
			limit: String(PAGE_SIZE),
			sortBy,
			sortOrder,
			...(debouncedSearchTerm ? { search: debouncedSearchTerm } : {}),
			...(statusFilter ? { status: statusFilter } : {}),
			...(ownerFilter ? { owner: ownerFilter } : {}),
			...(reviewOnly ? { review: '1' } : {}),
			...(cityFilter ? { city: cityFilter } : {}),
		}),
		[
			currentPage,
			debouncedSearchTerm,
			statusFilter,
			ownerFilter,
			reviewOnly,
			cityFilter,
			sortBy,
			sortOrder,
		]
	);
	const listQuery = useLeadList(
		listParams,
		activeTab === 'list' && canViewLeads
	);
	const companiesQuery = useCompanyDirectory(activeTab === 'add' && canCreate);
	const deleteMutation = useMutation<
		{ success: boolean },
		Error,
		{ leadId: number }
	>({
		mutationFn: ({ leadId }) => apiDelete(`/api/leads/${leadId}`),
		onSuccess: () => {
			alert('Lead deleted successfully!');
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
		},
		onError: (error) => {
			alert('Error deleting lead: ' + error.message);
		},
	});

	const leads = listQuery.data?.data.leads ?? [];
	const stats = { ...EMPTY_STATS, ...(listQuery.data?.data.stats ?? {}) };
	const paginationTotal = listQuery.data?.data.pagination?.total ?? 0;
	const totalPages = listQuery.data?.data.pagination?.totalPages ?? 1;
	const loading = listQuery.isPending;
	const loadError =
		listQuery.error instanceof Error ? listQuery.error.message : null;
	const companies = companiesQuery.data?.data ?? [];

	useEffect(() => {
		clearTimeout(searchDebounceRef.current);
		searchDebounceRef.current = window.setTimeout(() => {
			setCurrentPage(1);
			setDebouncedSearchTerm(searchTerm.trim());
		}, 350);
		return () => {
			clearTimeout(searchDebounceRef.current);
		};
	}, [searchTerm]);

	const clearFilters = (): void => {
		setSearchTerm('');
		setDebouncedSearchTerm('');
		setStatusFilter('');
		setOwnerFilter('');
		setReviewOnly(false);
		setCityFilter('');
		setSortBy('enquiry_date');
		setSortOrder('desc');
		setCurrentPage(1);
	};

	const handleDeleteLead = (
		leadId: number,
		companyName: string | null
	): void => {
		if (
			!confirm(
				`Are you sure you want to delete the lead for "${companyName ?? 'this company'}"? This will mark it as deleted.`
			)
		) {
			return;
		}
		deleteMutation.mutate({ leadId });
	};

	const sessionUser = user as SessionUserShape | null;
	const creatorLabel =
		sessionUser && typeof sessionUser.full_name === 'string'
			? sessionUser.full_name
			: '';

	const renderLeadsList = () => (
		<div className="space-y-6">
			<div
				className="grid grid-cols-1 gap-6 sm:grid-cols-3"
				aria-label="Lead counters"
			>
				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
							<UserGroupIcon className="h-5 w-5" />
						</span>
						<div className="ml-4">
							<p className="text-sm font-medium text-black">Total Leads</p>
							<p className="text-2xl font-semibold text-gray-900">
								{stats.total_leads || 0}
							</p>
						</div>
					</div>
				</div>
				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<div className="ml-4">
							<p className="text-sm font-medium text-black">
								Unassigned intake
							</p>
							<p className="text-2xl font-semibold text-gray-900">
								{stats.unassigned_leads || 0}
							</p>
						</div>
					</div>
				</div>
				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<div className="ml-4">
							<p className="text-sm font-medium text-black">Needs review</p>
							<p className="text-2xl font-semibold text-gray-900">
								{stats.needs_review_leads || 0}
							</p>
						</div>
					</div>
				</div>
			</div>

			{canImport ? (
				<div className="bg-white rounded-lg border border-gray-200">
					<button
						type="button"
						onClick={() => setShowImport((value) => !value)}
						aria-expanded={showImport}
						className="w-full flex items-center justify-between px-4 py-3 text-left"
					>
						<div className="flex items-center gap-2">
							<DocumentTextIcon className="h-5 w-5 text-accent-purple" />
							<h3 className="text-base font-medium text-gray-900">
								Import Leads
							</h3>
							<span className="ml-2 text-xs text-gray-500">
								CSV template supported
							</span>
						</div>
						{showImport ? (
							<ChevronUpIcon className="h-5 w-5 text-gray-500" />
						) : (
							<ChevronDownIcon className="h-5 w-5 text-gray-500" />
						)}
					</button>
					{showImport ? (
						<div className="px-4 pb-4">
							<LeadImportForm
								canImport={canImport}
								canAssign={canAssign}
								onImported={() => {
									setCurrentPage(1);
								}}
							/>
						</div>
					) : null}
				</div>
			) : null}

			<div className="bg-white rounded-lg border border-gray-200 p-4">
				<div className="flex flex-col lg:flex-row gap-3 lg:items-end">
					<div className="flex-1">
						<label htmlFor="leads-search" className="sr-only">
							Search leads
						</label>
						<div className="relative">
							<MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
							<input
								id="leads-search"
								type="text"
								placeholder="Search leads by company, contact, or project..."
								value={searchTerm}
								onChange={(event) => setSearchTerm(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										clearTimeout(searchDebounceRef.current);
										setDebouncedSearchTerm(searchTerm.trim());
										setCurrentPage(1);
									}
								}}
								className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
							/>
						</div>
					</div>
					<div className="sm:w-52">
						<label
							htmlFor="leads-stage-filter"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							Lead Stage
						</label>
						<select
							id="leads-stage-filter"
							value={statusFilter}
							onChange={(event) => {
								setStatusFilter(event.target.value);
								setCurrentPage(1);
							}}
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
						>
							<option value="">All stages</option>
							{LEAD_STAGES.map((stage) => (
								<option key={stage} value={stage}>
									{stage}
								</option>
							))}
							<option value="Unresolved">Unresolved</option>
						</select>
					</div>
					<div className="sm:w-52">
						<label
							htmlFor="leads-owner-filter"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							Lead Owner
						</label>
						<select
							id="leads-owner-filter"
							value={ownerFilter}
							onChange={(event) => {
								setOwnerFilter(event.target.value);
								setCurrentPage(1);
							}}
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
						>
							<option value="">All owners</option>
							<option value="unassigned">Unassigned intake</option>
						</select>
					</div>
					{canAssign ? (
						<div className="sm:w-52">
							<label
								htmlFor="leads-owner-picker"
								className="block text-xs font-medium text-gray-600 mb-1"
							>
								Filter by owner
							</label>
							<OwnerSelect
								id="leads-owner-picker"
								value={
									ownerFilter !== '' && ownerFilter !== 'unassigned'
										? Number(ownerFilter)
										: null
								}
								onChange={(next) => {
									setOwnerFilter(next === null ? '' : String(next));
									setCurrentPage(1);
								}}
								intakeLabel="All owners"
							/>
						</div>
					) : null}
					<div className="sm:w-32">
						<label
							htmlFor="leads-city-filter"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							City
						</label>
						<select
							id="leads-city-filter"
							value={cityFilter}
							onChange={(event) => {
								setCityFilter(event.target.value);
								setCurrentPage(1);
							}}
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
						>
							<option value="">All Cities</option>
							<option value="Mumbai">Mumbai</option>
							<option value="Delhi">Delhi</option>
							<option value="Pune">Pune</option>
							<option value="Gujarat">Gujarat</option>
							<option value="Kolkata">Kolkata</option>
						</select>
					</div>
					<div className="sm:w-48">
						<label
							htmlFor="leads-sort"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							Sort
						</label>
						<select
							id="leads-sort"
							value={`${sortBy}-${sortOrder}`}
							onChange={(event) => {
								const [field, order] = event.target.value.split('-');
								setSortBy(field);
								setSortOrder(order);
							}}
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
						>
							<option value="enquiry_date-desc">Date: Newest First</option>
							<option value="enquiry_date-asc">Date: Oldest First</option>
							<option value="created_at-desc">Recently Added</option>
							<option value="company_name-asc">Company A-Z</option>
							<option value="company_name-desc">Company Z-A</option>
							<option value="enquiry_status-asc">Stage A-Z</option>
						</select>
					</div>
					<div className="flex items-center gap-2">
						<input
							id="leads-review-filter"
							type="checkbox"
							checked={reviewOnly}
							onChange={(event) => {
								setReviewOnly(event.target.checked);
								setCurrentPage(1);
							}}
							className="h-4 w-4 rounded border-gray-300"
						/>
						<label
							htmlFor="leads-review-filter"
							className="text-sm text-gray-700"
						>
							Needs review only
						</label>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={clearFilters}
							className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50"
						>
							<FunnelIcon className="h-4 w-4 mr-1 text-gray-500" />
							Clear
						</button>
					</div>
				</div>
			</div>

			<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
				{loading ? (
					<div className="p-8 text-center" role="status">
						<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent-purple"></div>
						<p className="mt-2 text-gray-600">Loading leads...</p>
					</div>
				) : loadError ? (
					<div className="p-8 text-center">
						<h3 className="text-sm font-medium text-gray-900">
							Could not load leads
						</h3>
						<p className="mt-1 text-sm text-gray-500" role="alert">
							{loadError}
						</p>
						<button
							type="button"
							onClick={() => void listQuery.refetch()}
							className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
						>
							Retry
						</button>
					</div>
				) : leads.length === 0 ? (
					<div className="p-8 text-center">
						<UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
						<h3 className="mt-2 text-sm font-medium text-gray-900">
							No leads found
						</h3>
						<p className="mt-1 text-sm text-gray-500">
							Get started by adding leads manually or importing from CSV.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-gray-200 table-fixed">
							<thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/75">
								<tr>
									<th className="w-14 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Sr
									</th>
									<th className="w-64 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Company & Contact
									</th>
									<th className="w-56 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Project Description
									</th>
									<th className="w-56 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Owner
									</th>
									<th className="w-32 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Stage & Priority
									</th>
									<th className="w-28 px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Date & Source
									</th>
									<th className="w-40 px-4 py-3 text-center text-xs font-medium text-black uppercase tracking-wider">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-200">
								{leads.map((lead, index) => (
									<tr
										key={lead.id}
										className="hover:bg-gray-50 odd:bg-white even:bg-gray-50"
									>
										<td className="w-14 px-4 py-3 whitespace-nowrap">
											<div className="text-sm font-medium text-gray-900">
												{paginationTotal -
													((currentPage - 1) * PAGE_SIZE + index)}
											</div>
										</td>
										<td className="w-64 px-4 py-3">
											<div>
												<div className="text-sm font-medium text-gray-900 truncate">
													{lead.company_name}
												</div>
												<div className="text-sm text-gray-500 truncate">
													{lead.contact_name}
												</div>
												<div className="flex items-center mt-1 space-x-3">
													{lead.contact_email ? (
														<div className="flex items-center text-xs text-gray-400">
															<EnvelopeIcon className="h-3 w-3 mr-1 flex-shrink-0" />
															<span className="truncate max-w-[8rem]">
																{lead.contact_email}
															</span>
														</div>
													) : null}
													{lead.phone ? (
														<div className="flex items-center text-xs text-gray-400">
															<PhoneIcon className="h-3 w-3 mr-1 flex-shrink-0" />
															<span className="truncate">{lead.phone}</span>
														</div>
													) : null}
												</div>
											</div>
										</td>
										<td className="w-56 px-4 py-3">
											<div
												className="text-sm text-gray-900 line-clamp-2"
												title={lead.project_description || ''}
											>
												{lead.project_description || '-'}
											</div>
										</td>
										<td className="w-56 px-4 py-3">
											<div className="text-sm text-gray-900">
												<div className="font-medium">
													{lead.owner_name ?? 'Unassigned intake'}
												</div>
												{lead.legacy_review_required ? (
													<span className="inline-flex mt-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs">
														Needs review
													</span>
												) : null}
											</div>
										</td>
										<td className="w-32 px-4 py-3 whitespace-nowrap">
											<div className="space-y-1">
												<LeadStageBadge stage={lead.enquiry_status} />
												<div
													className={cn(
														'text-xs font-medium',
														PRIORITY_TONES[
															lead.priority?.toLowerCase() ?? ''
														] ?? 'text-gray-500'
													)}
												>
													{lead.priority} Priority
												</div>
											</div>
										</td>
										<td className="w-28 px-4 py-3 whitespace-nowrap">
											<div className="text-sm text-gray-500 space-y-1">
												<div>{formatDate(lead.enquiry_date)}</div>
												{lead.lead_source ? (
													<div className="text-xs text-gray-400 truncate">
														via {lead.lead_source}
													</div>
												) : null}
											</div>
										</td>
										<td className="w-40 px-4 py-3 whitespace-nowrap text-center text-sm font-medium">
											<div className="flex items-center justify-center space-x-1">
												<button
													type="button"
													onClick={() => router.push(`/leads/${lead.id}`)}
													className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
													title="View Details"
													aria-label={`View lead ${lead.company_name ?? lead.id}`}
												>
													<EyeIcon className="h-4 w-4" />
												</button>
												{canUpdate ? (
													<button
														type="button"
														onClick={() =>
															router.push(`/leads/${lead.id}/edit`)
														}
														className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
														title="Edit Lead"
														aria-label={`Edit lead ${lead.company_name ?? lead.id}`}
													>
														<PencilIcon className="h-4 w-4" />
													</button>
												) : null}
												{canDelete ? (
													<button
														type="button"
														onClick={() =>
															handleDeleteLead(lead.id, lead.company_name)
														}
														className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
														title="Delete Lead"
														aria-label={`Delete lead ${lead.company_name ?? lead.id}`}
													>
														<TrashIcon className="h-4 w-4" />
													</button>
												) : null}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{leads.length > 0 ? (
				<div className="flex items-center justify-between">
					<div className="flex items-center text-sm text-gray-700">
						Showing {(currentPage - 1) * PAGE_SIZE + 1} to{' '}
						{Math.min(currentPage * PAGE_SIZE, paginationTotal)} of{' '}
						{paginationTotal} leads
					</div>
					<div className="flex items-center space-x-2">
						<button
							type="button"
							onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
							disabled={currentPage === 1}
							className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 inline-flex items-center gap-1"
						>
							<ArrowLeftIcon className="h-4 w-4" />
							Previous
						</button>
						<span className="px-3 py-1 text-sm text-gray-700">
							Page {currentPage} of {totalPages}
						</span>
						<button
							type="button"
							onClick={() => setCurrentPage(currentPage + 1)}
							disabled={currentPage >= totalPages}
							className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 inline-flex items-center gap-1"
						>
							Next
							<ArrowRightIcon className="h-4 w-4" />
						</button>
					</div>
				</div>
			) : null}
		</div>
	);

	const renderAddLeadForm = () => (
		<div className="h-full">
			<div className="flex-shrink-0 mb-6">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold text-gray-900">Add New Lead</h2>
						<p className="text-gray-600 mt-1">
							Create a new lead. It starts at New with the creator as owner.
						</p>
					</div>
					<div className="text-sm text-gray-500">
						<span className="text-red-500">*</span> Required fields
					</div>
				</div>
			</div>
			{canCreate ? (
				<LeadCreateForm
					companies={companies}
					creatorLabel={creatorLabel || null}
					canAssign={canAssign}
					onCreated={() => {
						setActiveTab('list');
						setCurrentPage(1);
						alert('Lead created successfully!');
					}}
					onCancel={() => setActiveTab('list')}
				/>
			) : (
				<p className="text-sm text-gray-600">
					You do not have permission to create leads.
				</p>
			)}
		</div>
	);

	if (!rbacLoading && !canViewLeads) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
				<Navbar />
				<div className="px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16 py-8 pt-20 max-w-[1800px] mx-auto">
					<div className="flex items-center justify-center h-[calc(100vh-120px)]">
						<div className="text-center">
							<LockClosedIcon className="h-16 w-16 text-gray-400 mx-auto" />
							<h2 className="mt-4 text-xl font-semibold text-gray-900">
								Access Denied
							</h2>
							<p className="mt-2 text-gray-600">
								{"You don't have permission to view leads."}
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-shrink-0 pt-24 px-6 lg:px-8 xl:px-12 2xl:px-16 pb-4 max-w-[1920px] mx-auto w-full">
				<div className="mb-6">
					<h1 className="text-3xl xl:text-4xl font-bold text-black mb-2">
						Leads Management
					</h1>
					<p className="text-gray-600 xl:text-lg">
						Manage your leads through manual entry or CSV import
					</p>
				</div>
				<div
					role="tablist"
					aria-label="Leads sections"
					className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4"
				>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === 'list'}
						onClick={() => setActiveTab('list')}
						className={cn(
							'px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors',
							activeTab === 'list'
								? 'border-black text-black bg-gray-50'
								: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
						)}
					>
						<UserGroupIcon className="h-5 w-5 inline mr-2" />
						All Leads ({stats.total_leads || 0})
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === 'add'}
						onClick={() => setActiveTab('add')}
						className={cn(
							'px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors',
							activeTab === 'add'
								? 'border-black text-black bg-gray-50'
								: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
						)}
					>
						<PlusIcon className="h-5 w-5 inline mr-2" />
						Add Lead
					</button>
				</div>
			</div>
			<div className="flex-1 px-6 lg:px-8 xl:px-12 2xl:px-16 overflow-hidden">
				<div className="h-full overflow-y-auto bg-white rounded-b-lg">
					<div className="p-6">
						{activeTab === 'list' ? renderLeadsList() : renderAddLeadForm()}
					</div>
				</div>
			</div>
		</div>
	);
}
