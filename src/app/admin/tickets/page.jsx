'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useSession } from '@/context/SessionContext';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { TICKET_STATUSES } from '@/lib/tickets/constants';
import TicketDepartmentSettings from '@/components/tickets/TicketDepartmentSettings';
import {
	TicketIcon,
	MagnifyingGlassIcon,
	UserIcon,
	ClockIcon,
	ChatBubbleLeftRightIcon,
	PaperClipIcon,
	XMarkIcon,
	CheckCircleIcon,
	ArrowPathIcon,
	UserGroupIcon,
	ShieldCheckIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	ExclamationTriangleIcon,
	InboxIcon,
	BoltIcon,
	LockClosedIcon,
} from '@heroicons/react/24/outline';

const PRIORITIES = [
	{
		value: 'low',
		label: 'Low',
		color: 'bg-gray-100 text-gray-700 border-gray-300',
	},
	{
		value: 'medium',
		label: 'Medium',
		color: 'bg-blue-100 text-blue-700 border-blue-300',
	},
	{
		value: 'high',
		label: 'High',
		color: 'bg-orange-100 text-orange-700 border-orange-300',
	},
	{
		value: 'critical',
		label: 'Critical',
		color: 'bg-red-100 text-red-700 border-red-300',
	},
];

// Labels are the persisted status enum (shared with the ticket surfaces);
// only the badge colours and icons stay local to this admin page.
const STATUS_META = {
	open: {
		color: 'bg-blue-100 text-blue-800',
		statColor: 'text-blue-600',
		Icon: InboxIcon,
	},
	in_progress: {
		color: 'bg-yellow-100 text-yellow-800',
		statColor: 'text-yellow-600',
		Icon: BoltIcon,
	},
	pending_info: {
		color: 'bg-orange-100 text-orange-800',
		statColor: 'text-orange-600',
		Icon: ClockIcon,
	},
	resolved: {
		color: 'bg-green-100 text-green-800',
		statColor: 'text-green-600',
		Icon: CheckCircleIcon,
	},
	closed: {
		color: 'bg-gray-100 text-gray-800',
		statColor: 'text-gray-600',
		Icon: LockClosedIcon,
	},
};

const STATUSES = TICKET_STATUSES.map((status) => ({
	...status,
	...STATUS_META[status.value],
}));

function messageOf(error, fallback) {
	return error instanceof Error && error.message ? error.message : fallback;
}

export default function TicketManagementPage() {
	const { user } = useSession();
	const isSuperAdmin =
		user?.is_super_admin === true ||
		user?.is_super_admin === 1 ||
		user?.is_super_admin === '1';

	const [showViewModal, setShowViewModal] = useState(false);
	const [selectedTicket, setSelectedTicket] = useState(null);
	const [modalError, setModalError] = useState('');

	const [filterStatus, setFilterStatus] = useState('');
	const [filterPriority, setFilterPriority] = useState('');
	const [filterDepartmentId, setFilterDepartmentId] = useState('');

	const [searchQuery, setSearchQuery] = useState('');
	const [newComment, setNewComment] = useState('');
	const [submittingComment, setSubmittingComment] = useState(false);
	const [updatingTicket, setUpdatingTicket] = useState(false);
	const [showDepartments, setShowDepartments] = useState(true);

	const departmentsQuery = useQuery({
		queryKey: ['ticket-departments', 'selectable'],
		queryFn: async () => (await apiGet('/api/ticket-departments')).data ?? [],
	});

	const departments = departmentsQuery.data ?? [];
	const selectableDepartmentIds = new Set(
		departments.map((department) => Number(department.id))
	);

	// Super admins can also filter by departments that are disabled or missing
	// a responsible role, so they request the same `?all=true` catalog the
	// settings panel uses. The request stays disabled for everyone else,
	// keeping role metadata out of their caches.
	const allDepartmentsQuery = useQuery({
		queryKey: ['ticket-departments', 'all'],
		queryFn: async () =>
			(await apiGet('/api/ticket-departments', { all: true })).data ?? [],
		enabled: isSuperAdmin,
	});

	const allDepartments = allDepartmentsQuery.data ?? [];

	const filterDepartments =
		isSuperAdmin && allDepartmentsQuery.data ? allDepartments : departments;
	const filterDepartmentsQuery = isSuperAdmin
		? allDepartmentsQuery
		: departmentsQuery;

	// Keep the selected filter even when its department stops being offered:
	// the tickets API already filters by id, and silently clearing it would
	// drop the rows the admin was looking at.
	const departmentFilter = filterDepartmentId;

	const ticketsQuery = useQuery({
		queryKey: [
			'tickets',
			'admin',
			filterStatus,
			filterPriority,
			departmentFilter,
		],
		queryFn: () =>
			apiGet('/api/tickets', {
				all: 'true',
				status: filterStatus,
				priority: filterPriority,
				ticket_department_id: departmentFilter,
			}),
	});

	const tickets = ticketsQuery.data?.data ?? [];

	const refreshSelectedTicket = async (ticketId) => {
		try {
			const res = await apiGet(`/api/tickets/${ticketId}`);
			setSelectedTicket(res.data);
			setModalError('');
		} catch (error) {
			setModalError(
				messageOf(error, 'Could not refresh the ticket. Close and reopen it.')
			);
		}
	};

	const handleViewTicket = async (ticket) => {
		try {
			const res = await apiGet(`/api/tickets/${ticket.id}`);
			setSelectedTicket(res.data);
			setNewComment('');
			setModalError('');
			setShowViewModal(true);
		} catch (error) {
			toast.error(messageOf(error, 'Could not load the ticket'));
		}
	};

	const handleUpdateStatus = async (
		ticketId,
		newStatus,
		resolutionNotes = null
	) => {
		setUpdatingTicket(true);
		setModalError('');
		try {
			const payload = { id: ticketId, status: newStatus };
			if (resolutionNotes) payload.resolution_notes = resolutionNotes;

			await apiPut('/api/tickets', payload);
			await ticketsQuery.refetch();
			await refreshSelectedTicket(ticketId);
			return true;
		} catch (error) {
			setModalError(messageOf(error, 'Failed to update the ticket'));
			return false;
		} finally {
			setUpdatingTicket(false);
		}
	};

	const reassignMutation = useMutation({
		mutationFn: ({ ticketId, departmentId }) =>
			apiPut('/api/tickets', {
				id: ticketId,
				ticket_department_id: departmentId,
			}),
		onSuccess: async (_result, variables) => {
			toast.success('Ticket reassigned');
			await ticketsQuery.refetch();
			await refreshSelectedTicket(variables.ticketId);
		},
		onError: (error) => {
			setModalError(messageOf(error, 'Failed to reassign the ticket'));
		},
	});

	const handleReassign = (value) => {
		const departmentId = Number(value);
		if (!Number.isInteger(departmentId) || departmentId <= 0) return;
		setModalError('');
		reassignMutation.mutate({
			ticketId: selectedTicket.id,
			departmentId,
		});
	};

	const handleAddComment = async (ticketId) => {
		if (!newComment.trim()) return;

		setSubmittingComment(true);
		setModalError('');
		try {
			await apiPost(`/api/tickets/${ticketId}`, { comment: newComment });
			setNewComment('');
			await refreshSelectedTicket(ticketId);
		} catch (error) {
			setModalError(messageOf(error, 'Failed to add the comment'));
		} finally {
			setSubmittingComment(false);
		}
	};

	const closeViewModal = () => {
		setShowViewModal(false);
		setSelectedTicket(null);
		setNewComment('');
		setModalError('');
	};

	const matchesSearch = (ticket) => {
		if (!searchQuery) return true;
		const query = searchQuery.toLowerCase();
		return [
			ticket.subject,
			ticket.ticket_number,
			ticket.description,
			ticket.user_name,
			ticket.ticket_department_name,
		].some((value) =>
			String(value ?? '')
				.toLowerCase()
				.includes(query)
		);
	};

	const filteredTickets = tickets.filter(matchesSearch);

	const getStatusBadge = (status) => {
		const statusConfig = STATUSES.find((s) => s.value === status);
		return statusConfig ? (
			<span
				className={`px-3 py-1 text-xs font-semibold rounded-full ${statusConfig.color} inline-flex items-center gap-1`}
			>
				<statusConfig.Icon className="h-3.5 w-3.5" />
				{statusConfig.label}
			</span>
		) : (
			status
		);
	};

	const getPriorityBadge = (priority) => {
		const priorityConfig = PRIORITIES.find((p) => p.value === priority);
		return priorityConfig ? (
			<span
				className={`px-3 py-1 text-xs font-semibold rounded-full border ${priorityConfig.color}`}
			>
				{priorityConfig.label}
			</span>
		) : (
			priority
		);
	};

	const filtersActive =
		filterStatus || filterPriority || departmentFilter || searchQuery;

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16 py-8">
				{/* Header */}
				<div className="mb-8 flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
							<ShieldCheckIcon className="h-8 w-8 text-indigo-600" />
							Ticket Management
						</h1>
						<p className="text-gray-600 mt-2">
							Manage and resolve employee support tickets
						</p>
					</div>
					{isSuperAdmin && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowDepartments((open) => !open)}
							aria-expanded={showDepartments}
							aria-controls="ticket-department-settings"
						>
							<ChevronUpIcon
								className={`h-4 w-4 ${showDepartments ? '' : 'hidden'}`}
							/>
							<ChevronDownIcon
								className={`h-4 w-4 ${showDepartments ? 'hidden' : ''}`}
							/>
							Department settings
						</Button>
					)}
				</div>

				{/* Department routing (super-admin only) */}
				{isSuperAdmin && showDepartments && (
					<section
						id="ticket-department-settings"
						aria-label="Department routing settings"
						className="mb-6"
					>
						<TicketDepartmentSettings isSuperAdmin={isSuperAdmin} />
					</section>
				)}

				{/* Stats Cards */}
				<div className="flex flex-wrap gap-4 mb-6">
					{STATUSES.map((status) => (
						<div
							key={status.value}
							className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-[120px] px-3 py-2"
						>
							<div className={`text-lg font-bold ${status.statColor}`}>
								{
									tickets.filter((ticket) => ticket.status === status.value)
										.length
								}
							</div>
							<div className="text-xs text-gray-600">{status.label}</div>
						</div>
					))}
				</div>

				{/* Filters */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
					<div className="flex flex-wrap gap-4 items-center">
						<div className="flex-1 min-w-[250px]">
							<div className="relative">
								<MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
								<input
									type="text"
									placeholder="Search tickets..."
									aria-label="Search tickets"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
								/>
							</div>
						</div>

						<select
							value={filterStatus}
							onChange={(e) => setFilterStatus(e.target.value)}
							aria-label="Filter by status"
							className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
						>
							<option value="">All Statuses</option>
							{STATUSES.map((status) => (
								<option key={status.value} value={status.value}>
									{status.label}
								</option>
							))}
						</select>

						<select
							value={filterPriority}
							onChange={(e) => setFilterPriority(e.target.value)}
							aria-label="Filter by priority"
							className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
						>
							<option value="">All Priorities</option>
							{PRIORITIES.map((priority) => (
								<option key={priority.value} value={priority.value}>
									{priority.label}
								</option>
							))}
						</select>

						<select
							value={departmentFilter}
							onChange={(e) => setFilterDepartmentId(e.target.value)}
							aria-label="Filter by department"
							disabled={filterDepartmentsQuery.isLoading}
							className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm disabled:opacity-50"
						>
							<option value="">All Departments</option>
							{departmentFilter &&
								!filterDepartments.some(
									(department) => String(department.id) === departmentFilter
								) && (
									<option value={departmentFilter}>
										Department #{departmentFilter} (unavailable)
									</option>
								)}
							{filterDepartments.map((department) => (
								<option key={department.id} value={department.id}>
									{department.name}
									{selectableDepartmentIds.has(Number(department.id))
										? ''
										: ' (unavailable for new tickets)'}
								</option>
							))}
						</select>

						{filtersActive && (
							<button
								onClick={() => {
									setFilterStatus('');
									setFilterPriority('');
									setFilterDepartmentId('');
									setSearchQuery('');
								}}
								className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
							>
								<XMarkIcon className="h-4 w-4" />
								Clear
							</button>
						)}
					</div>
					{(filterDepartmentsQuery.isError ||
						(isSuperAdmin && departmentsQuery.isError)) && (
						<p className="mt-3 text-sm text-red-600" role="alert">
							Could not load departments:{' '}
							{messageOf(
								filterDepartmentsQuery.error ?? departmentsQuery.error,
								'unknown error'
							)}
							.{' '}
							<button
								onClick={() => {
									void filterDepartmentsQuery.refetch();
									if (isSuperAdmin) void departmentsQuery.refetch();
								}}
								className="font-medium text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
							>
								Try again
							</button>
						</p>
					)}
				</div>

				{/* Tickets List */}
				{ticketsQuery.isError ? (
					<div
						className="bg-white rounded-xl shadow-sm border border-red-200 p-12 text-center"
						role="alert"
					>
						<ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							Could not load tickets
						</h3>
						<p className="text-gray-600 mb-4">
							{messageOf(ticketsQuery.error, 'Something went wrong')}
						</p>
						<Button onClick={() => ticketsQuery.refetch()}>
							<ArrowPathIcon className="h-4 w-4" />
							Try again
						</Button>
					</div>
				) : ticketsQuery.isLoading ? (
					<div className="text-center py-12">
						<ArrowPathIcon className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
						<p className="text-gray-500">Loading tickets...</p>
					</div>
				) : filteredTickets.length === 0 ? (
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
						<TicketIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							No tickets found
						</h3>
						<p className="text-gray-500">
							{filtersActive
								? 'Try adjusting your filters'
								: 'No tickets have been submitted yet'}
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{filteredTickets.map((ticket) => {
							return (
								<div
									key={ticket.id}
									onClick={() => handleViewTicket(ticket)}
									className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all cursor-pointer hover:border-indigo-300"
								>
									<div className="flex items-start justify-between gap-4">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-3 mb-2 flex-wrap">
												<span className="text-sm font-mono text-gray-500">
													#{ticket.ticket_number}
												</span>
												{getStatusBadge(ticket.status)}
												{getPriorityBadge(ticket.priority)}
											</div>
											<h3 className="text-lg font-semibold text-gray-900 mb-2">
												{ticket.subject}
											</h3>
											<p className="text-gray-600 text-sm line-clamp-2 mb-2">
												{ticket.description}
											</p>
											<div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
												<span className="flex items-center gap-1">
													<UserIcon className="h-4 w-4" />
													{ticket.user_name}
												</span>
												<span className="flex items-center gap-1">
													<ClockIcon className="h-4 w-4" />
													{new Date(ticket.created_at).toLocaleString()}
												</span>
												<span
													className={`flex items-center gap-1 ${
														ticket.ticket_department_name &&
														!ticket.ticket_role_name
															? 'text-amber-700'
															: 'text-indigo-600'
													}`}
												>
													<UserGroupIcon className="h-4 w-4" />
													{ticket.ticket_department_name
														? `Department: ${ticket.ticket_department_name}${
																ticket.ticket_role_name
																	? ` (${ticket.ticket_role_name})`
																	: ' (no responsible role)'
															}`
														: 'Not routed to a department'}
												</span>
												{ticket.attachment_url && (
													<span className="flex items-center gap-1 text-indigo-600">
														<PaperClipIcon className="h-4 w-4" />
														Attachment
													</span>
												)}
											</div>
										</div>
										<ChatBubbleLeftRightIcon className="h-6 w-6 text-gray-400" />
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* View/Manage Ticket Modal */}
			{showViewModal && selectedTicket && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
					<div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8">
						<div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
							<div>
								<h2 className="text-xl font-bold text-gray-900">
									Ticket #{selectedTicket.ticket_number}
								</h2>
								<p className="text-sm text-gray-500">
									By {selectedTicket.user_name} on{' '}
									{new Date(selectedTicket.created_at).toLocaleString()}
								</p>
							</div>
							<button
								onClick={closeViewModal}
								aria-label="Close ticket"
								className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
							>
								<XMarkIcon className="h-6 w-6 text-gray-500" />
							</button>
						</div>

						<div className="p-6 space-y-6 max-h-[calc(90vh-200px)] overflow-y-auto">
							{modalError && (
								<div
									className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
									role="alert"
								>
									{modalError}
								</div>
							)}

							{/* Quick Actions */}
							{selectedTicket.can_update_status === true ? (
								<div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
									<h4 className="font-semibold text-gray-900 mb-3">
										Quick Actions
									</h4>
									<div className="flex flex-wrap gap-2">
										{STATUSES.map((status) => (
											<button
												key={status.value}
												onClick={() => {
													if (
														status.value === 'resolved' ||
														status.value === 'closed'
													) {
														const notes = prompt('Enter resolution notes:');
														if (notes)
															handleUpdateStatus(
																selectedTicket.id,
																status.value,
																notes
															);
													} else {
														handleUpdateStatus(selectedTicket.id, status.value);
													}
												}}
												disabled={
													updatingTicket ||
													selectedTicket.status === status.value
												}
												className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
													selectedTicket.status === status.value
														? `${status.color} font-semibold`
														: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
												}`}
											>
												<status.Icon className="h-4 w-4" />
												{status.label}
											</button>
										))}
									</div>
								</div>
							) : (
								<div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
									Only the employee who submitted this ticket, a current handler
									for its department, or a super admin can change its status.
								</div>
							)}

							{/* Responsible Department */}
							<div className="bg-gray-50 rounded-lg p-4">
								{selectedTicket.can_reassign === true ? (
									<>
										<label
											htmlFor="ticket-department"
											className="block text-sm font-semibold text-gray-700 mb-2"
										>
											Responsible department
										</label>
										<select
											id="ticket-department"
											value={selectedTicket.ticket_department_id ?? ''}
											onChange={(e) => handleReassign(e.target.value)}
											disabled={
												reassignMutation.isPending || departments.length === 0
											}
											className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
										>
											<option value="" disabled>
												{departments.length === 0
													? 'No configured departments available'
													: 'Select a department'}
											</option>
											{selectedTicket.ticket_department_id &&
												!departments.some(
													(department) =>
														Number(department.id) ===
														Number(selectedTicket.ticket_department_id)
												) && (
													<option
														value={selectedTicket.ticket_department_id}
														disabled
													>
														{selectedTicket.ticket_department_name ??
															`Department #${selectedTicket.ticket_department_id}`}{' '}
														(unavailable for new tickets)
													</option>
												)}
											{departments.map((department) => (
												<option key={department.id} value={department.id}>
													{department.role_name
														? `${department.name} \u2014 ${department.role_name}`
														: department.name}
												</option>
											))}
										</select>
										<p className="text-xs text-gray-500 mt-2">
											Every active member of the department&rsquo;s role is
											notified. Reassigning ends the previous team&rsquo;s
											access to this ticket.
										</p>
										{reassignMutation.isPending && (
											<p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
												<ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
												Saving department...
											</p>
										)}
									</>
								) : (
									<>
										<p className="block text-sm font-semibold text-gray-700 mb-2">
											Responsible department
										</p>
										<p className="text-sm text-gray-700">
											{selectedTicket.ticket_department_name ? (
												<>
													{selectedTicket.ticket_department_name}
													{selectedTicket.ticket_role_name ? (
														` \u00b7 ${selectedTicket.ticket_role_name}`
													) : (
														<span className="font-medium text-amber-700">
															{` \u00b7 no responsible role`}
														</span>
													)}
												</>
											) : (
												'Not routed to a department'
											)}
											<span className="block text-xs text-gray-500 mt-1">
												Only a super admin can change a ticket&rsquo;s
												department.
											</span>
										</p>
									</>
								)}
							</div>

							{/* Status & Priority */}
							<div className="flex items-center gap-3 flex-wrap">
								{getStatusBadge(selectedTicket.status)}
								{getPriorityBadge(selectedTicket.priority)}
							</div>

							{/* Subject & Description */}
							<div>
								<h3 className="text-2xl font-bold text-gray-900 mb-3">
									{selectedTicket.subject}
								</h3>
								<p className="text-gray-700 whitespace-pre-wrap">
									{selectedTicket.description}
								</p>
							</div>

							{/* Attachment */}
							{selectedTicket.attachment_url && (
								<div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
									<PaperClipIcon className="h-6 w-6 text-gray-400" />
									<div className="flex-1">
										<p className="text-sm font-medium text-gray-900">
											Attachment
										</p>
										<a
											href={selectedTicket.attachment_url}
											target="_blank"
											rel="noopener noreferrer"
											className="text-sm text-indigo-600 hover:text-indigo-700 break-all"
										>
											{selectedTicket.attachment_url}
										</a>
									</div>
								</div>
							)}

							{/* Resolution Notes */}
							{selectedTicket.resolution_notes && (
								<div className="bg-green-50 border border-green-200 rounded-lg p-4">
									<p className="text-sm font-semibold text-green-800 mb-2">
										Resolution Notes
									</p>
									<p className="text-sm text-green-900 whitespace-pre-wrap">
										{selectedTicket.resolution_notes}
									</p>
									{selectedTicket.resolved_at && (
										<p className="text-xs text-green-700 mt-2">
											Resolved on{' '}
											{new Date(selectedTicket.resolved_at).toLocaleString()}
											{selectedTicket.resolved_by_name &&
												` by ${selectedTicket.resolved_by_name}`}
										</p>
									)}
								</div>
							)}

							{/* Comments */}
							<div>
								<h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
									<ChatBubbleLeftRightIcon className="h-5 w-5" />
									Comments ({selectedTicket.comments?.length || 0})
								</h4>
								<div className="space-y-3">
									{selectedTicket.comments?.map((comment) => (
										<div key={comment.id} className="bg-gray-50 rounded-lg p-4">
											<div className="flex items-start justify-between mb-2">
												<span className="font-medium text-gray-900">
													{comment.user_name}
												</span>
												<span className="text-xs text-gray-500">
													{new Date(comment.created_at).toLocaleString()}
												</span>
											</div>
											<p className="text-gray-700 text-sm whitespace-pre-wrap">
												{comment.comment}
											</p>
										</div>
									))}

									{/* Add Comment */}
									{selectedTicket.status !== 'closed' && (
										<div className="mt-4">
											<label htmlFor="new-ticket-comment" className="sr-only">
												Add a comment
											</label>
											<textarea
												id="new-ticket-comment"
												value={newComment}
												onChange={(e) => setNewComment(e.target.value)}
												placeholder="Add a comment or update to the employee..."
												rows={3}
												className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
											/>
											<div className="flex justify-end mt-2">
												<button
													onClick={() => handleAddComment(selectedTicket.id)}
													disabled={!newComment.trim() || submittingComment}
													className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
												>
													{submittingComment ? (
														<>
															<ArrowPathIcon className="h-4 w-4 animate-spin" />
															Sending...
														</>
													) : (
														<>
															<ChatBubbleLeftRightIcon className="h-4 w-4" />
															Add Comment
														</>
													)}
												</button>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
