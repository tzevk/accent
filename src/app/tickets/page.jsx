'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { apiGet } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { TICKET_STATUSES } from '@/lib/tickets/constants';
import {
	TicketIcon,
	PlusIcon,
	PaperClipIcon,
	XMarkIcon,
	MagnifyingGlassIcon,
	ArrowPathIcon,
	ExclamationTriangleIcon,
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
		label: 'Urgent',
		color: 'bg-red-100 text-red-700 border-red-300',
	},
];

/** Badge colours for the persisted ticket statuses; labels come from the shared enum. */
const STATUS_COLORS = {
	open: 'bg-blue-100 text-blue-800',
	in_progress: 'bg-yellow-100 text-yellow-800',
	pending_info: 'bg-orange-100 text-orange-800',
	resolved: 'bg-green-100 text-green-800',
	closed: 'bg-gray-100 text-gray-800',
};

export default function TicketsPage() {
	const router = useRouter();
	const [filterStatus, setFilterStatus] = useState('');
	const [filterPriority, setFilterPriority] = useState('');
	const [filterDepartment, setFilterDepartment] = useState('');
	const [searchQuery, setSearchQuery] = useState('');

	const ticketsQuery = useQuery({
		queryKey: [
			'tickets',
			{
				status: filterStatus,
				priority: filterPriority,
				department: filterDepartment,
			},
		],
		queryFn: () =>
			apiGet('/api/tickets', {
				status: filterStatus,
				priority: filterPriority,
				ticket_department_id: filterDepartment,
			}),
	});

	const departmentsQuery = useQuery({
		queryKey: ['ticket-departments'],
		queryFn: () => apiGet('/api/ticket-departments'),
		staleTime: 60_000,
	});

	const tickets = ticketsQuery.data?.data ?? [];
	const departments = departmentsQuery.data?.data ?? [];

	const searchLower = useMemo(() => searchQuery.toLowerCase(), [searchQuery]);

	const filteredTickets = useMemo(
		() =>
			tickets.filter(
				(ticket) =>
					searchQuery === '' ||
					ticket.subject?.toLowerCase().includes(searchLower) ||
					ticket.ticket_number?.toLowerCase().includes(searchLower) ||
					ticket.description?.toLowerCase().includes(searchLower) ||
					ticket.ticket_department_name?.toLowerCase().includes(searchLower) ||
					ticket.ticket_role_name?.toLowerCase().includes(searchLower)
			),
		[tickets, searchQuery, searchLower]
	);

	const getStatusBadge = (status) => {
		const config = TICKET_STATUSES.find((s) => s.value === status);
		if (!config) {
			return (
				<span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
					{status || 'Unknown'}
				</span>
			);
		}
		return (
			<span
				className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[config.value] || 'bg-gray-100 text-gray-700'}`}
			>
				{config.label}
			</span>
		);
	};

	const getPriorityBadge = (priority) => {
		const p = PRIORITIES.find((p) => p.value === priority);
		if (!p) return priority;
		return (
			<span
				className={`px-2 py-0.5 text-xs font-medium rounded-full border ${p.color}`}
			>
				{p.label}
			</span>
		);
	};

	const { activeCount, waitingCount } = useMemo(
		() => ({
			activeCount: tickets.filter(
				(t) => !['resolved', 'closed'].includes(t.status)
			).length,
			waitingCount: tickets.filter((t) => t.status === 'pending_info').length,
		}),
		[tickets]
	);

	const hasFilters =
		Boolean(filterStatus) ||
		Boolean(filterPriority) ||
		Boolean(filterDepartment) ||
		Boolean(searchQuery);

	const clearFilters = () => {
		setFilterStatus('');
		setFilterPriority('');
		setFilterDepartment('');
		setSearchQuery('');
	};

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="flex pt-2 sm:pl-16">
				<div className="flex-1">
					<div className="pl-0 pr-1 sm:pl-0.5 sm:pr-1.5 lg:pl-1 lg:pr-2 py-2">
						{/* Header */}
						<div className="flex items-center justify-between mb-6">
							<div>
								<h1 className="text-2xl font-bold text-gray-900">
									Support Tickets
								</h1>
								<p className="text-sm text-gray-500 mt-1">
									{activeCount} active
									{waitingCount > 0 &&
										` · ${waitingCount} waiting for employee`}
								</p>
							</div>
							<button
								type="button"
								onClick={() => router.push('/tickets/new')}
								className="flex items-center gap-2 px-4 py-2 bg-[#64126D] text-white text-sm font-medium rounded-lg hover:bg-[#7a1785] transition-colors"
							>
								<PlusIcon className="h-4 w-4" />
								New Ticket
							</button>
						</div>

						{/* Search & Filters */}
						<div className="flex flex-wrap gap-3 items-center mb-5">
							<div className="flex-1 min-w-[200px]">
								<div className="relative">
									<MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
									<input
										type="text"
										aria-label="Search tickets"
										placeholder="Search tickets..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
									/>
								</div>
							</div>

							<select
								aria-label="Filter by status"
								value={filterStatus}
								onChange={(e) => setFilterStatus(e.target.value)}
								className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
							>
								<option value="">All Statuses</option>
								{TICKET_STATUSES.map((s) => (
									<option key={s.value} value={s.value}>
										{s.label}
									</option>
								))}
							</select>

							<select
								aria-label="Filter by priority"
								value={filterPriority}
								onChange={(e) => setFilterPriority(e.target.value)}
								className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
							>
								<option value="">All Priorities</option>
								{PRIORITIES.map((p) => (
									<option key={p.value} value={p.value}>
										{p.label}
									</option>
								))}
							</select>

							{departments.length > 0 && (
								<select
									aria-label="Filter by responsible department"
									value={filterDepartment}
									onChange={(e) => setFilterDepartment(e.target.value)}
									className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
								>
									<option value="">All Departments</option>
									{departments.map((department) => (
										<option key={department.id} value={String(department.id)}>
											{department.name}
										</option>
									))}
								</select>
							)}

							{hasFilters && (
								<button
									type="button"
									onClick={clearFilters}
									className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
								>
									<XMarkIcon className="h-3.5 w-3.5" />
									Clear
								</button>
							)}
						</div>

						{/* Tickets List */}
						{ticketsQuery.isPending ? (
							<div className="text-center py-16">
								<ArrowPathIcon className="h-6 w-6 text-gray-400 animate-spin mx-auto mb-3" />
								<p className="text-sm text-gray-500">Loading...</p>
							</div>
						) : ticketsQuery.isError ? (
							<div
								role="alert"
								className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-center"
							>
								<ExclamationTriangleIcon className="h-6 w-6 text-red-600 mx-auto mb-2" />
								<p className="text-sm font-medium text-red-900">
									Could not load tickets
								</p>
								<p className="text-sm text-red-800 mt-1">
									{ticketsQuery.error?.message ||
										'The ticket list is unavailable right now.'}
								</p>
								<button
									type="button"
									onClick={() => ticketsQuery.refetch()}
									className="mt-3 px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785]"
								>
									Try again
								</button>
							</div>
						) : filteredTickets.length === 0 ? (
							<div className="text-center py-16">
								<TicketIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
								<p className="text-sm font-medium text-gray-900 mb-1">
									No tickets found
								</p>
								<p className="text-xs text-gray-500 mb-4">
									{hasFilters
										? 'Try adjusting your filters'
										: 'Tickets you submit or handle in your responsible department will appear here'}
								</p>
								{!hasFilters && (
									<button
										type="button"
										onClick={() => router.push('/tickets/new')}
										className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#64126D] text-white text-sm rounded-lg hover:bg-[#7a1785]"
									>
										<PlusIcon className="h-4 w-4" />
										New Ticket
									</button>
								)}
							</div>
						) : (
							<div className="space-y-2">
								{filteredTickets.map((ticket) => (
									<Link
										key={ticket.id}
										href={`/tickets/${ticket.id}`}
										className="block bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-[#64126D]/30 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 transition-all cursor-pointer"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1 flex-wrap">
													<span className="text-xs font-mono text-gray-400">
														{ticket.ticket_number}
													</span>
													{getStatusBadge(ticket.status)}
													{getPriorityBadge(ticket.priority)}
													{ticket.ticket_department_name && (
														<span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-[#64126D] border border-purple-200">
															{ticket.ticket_department_name}
															{ticket.ticket_role_name && (
																<span className="font-normal text-gray-600">
																	{' '}
																	· {ticket.ticket_role_name}
																</span>
															)}
														</span>
													)}
												</div>
												<h3 className="text-sm font-semibold text-gray-900 truncate">
													{ticket.subject}
												</h3>
												<p className="text-xs text-gray-500 truncate mt-0.5">
													{ticket.description}
												</p>
											</div>
											<div className="text-right shrink-0 flex flex-col items-end gap-1">
												<span className="text-xs text-gray-400">
													{formatDate(ticket.created_at)}
												</span>
												{ticket.attachment_url && (
													<PaperClipIcon className="h-3.5 w-3.5 text-gray-400" />
												)}
											</div>
										</div>
									</Link>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
