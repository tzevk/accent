'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	CheckIcon,
	XMarkIcon,
	ArrowPathIcon,
	CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Modal from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/form-fields';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';
import { apiGet, apiSend } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';

const PAGE_SIZE = 50;

type LeaveStatus = 'pending' | 'approved' | 'rejected';

interface AdminLeaveRow {
	id: number;
	user_id: number;
	applicant_name: string | null;
	leave_type_name: string;
	leave_type_code: string;
	is_paid: number | boolean;
	start_date: string;
	end_date: string;
	half_day: number | boolean;
	duration_days: string | number;
	reason: string | null;
	status: LeaveStatus;
	reviewer_name: string | null;
	reviewed_at: string | null;
	review_notes: string | null;
}

const STATUS_TABS: Array<{ value: string; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'all', label: 'All' },
];

const STATUS_BADGE: Record<string, string> = {
	pending: 'bg-amber-100 text-amber-700',
	approved: 'bg-emerald-100 text-emerald-700',
	rejected: 'bg-red-100 text-red-700',
};

export default function EmployeeLeavesPage() {
	const queryClient = useQueryClient();
	// SessionContext is untyped JS — cast like the reports pages do
	const { user, can, loading } = useSessionRBAC() as {
		loading: boolean;
		user: { id: number; full_name?: string } | null;
		can: (resource: string, permission: string) => boolean;
	};
	const canApprove = can(RESOURCES.LEAVES, PERMISSIONS.APPROVE);
	const canRead = can(RESOURCES.LEAVES, PERMISSIONS.READ);

	const [statusFilter, setStatusFilter] = useState('pending');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [page, setPage] = useState(1);
	const [rejectTarget, setRejectTarget] = useState<AdminLeaveRow | null>(null);
	const [rejectNotes, setRejectNotes] = useState('');

	const listQuery = useQuery<AdminLeaveRow[]>({
		queryKey: ['admin-leaves', { statusFilter, from, to, page }],
		queryFn: async () => {
			const res = await apiGet<{ data?: AdminLeaveRow[] }>('/api/leaves', {
				status: statusFilter,
				from,
				to,
				page,
				limit: PAGE_SIZE,
			});
			return res.data ?? [];
		},
		enabled: !loading && canRead,
	});

	const reviewMutation = useMutation({
		mutationFn: async ({
			id,
			status,
			review_notes,
		}: {
			id: number;
			status: LeaveStatus;
			review_notes?: string;
		}) => apiSend(`/api/leaves/${id}`, 'PATCH', { status, review_notes }),
		onSuccess: (_data, variables) => {
			toast.success(
				variables.status === 'approved' ? 'Leave approved' : 'Leave rejected'
			);
			setRejectTarget(null);
			setRejectNotes('');
			queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
			queryClient.invalidateQueries({ queryKey: ['leaves'] });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	function approve(row: AdminLeaveRow) {
		if (
			window.confirm(
				`Approve ${row.applicant_name ?? 'this employee'}'s leave (${Number(row.duration_days)} day(s))?`
			)
		) {
			reviewMutation.mutate({ id: row.id, status: 'approved' });
		}
	}

	function submitRejection() {
		if (!rejectTarget) return;
		if (!rejectNotes.trim()) {
			toast.error('A reason is required to reject a leave');
			return;
		}
		reviewMutation.mutate({
			id: rejectTarget.id,
			status: 'rejected',
			review_notes: rejectNotes.trim(),
		});
	}

	if (!loading && !canRead) {
		return (
			<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
				<Navbar />
				<Sidebar />
				<div className="content-with-sidebar flex-1 flex items-center justify-center">
					<p className="text-sm text-gray-500">
						You do not have permission to view leave applications.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-2 pb-4 px-2 sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-4">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Leave Requests
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Review and approve employee leave applications
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => listQuery.refetch()}
							disabled={listQuery.isFetching}
						>
							<ArrowPathIcon
								className={`h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`}
							/>
							Refresh
						</Button>
					</header>

					{/* Filters */}
					<div className="flex flex-wrap items-center gap-2">
						{STATUS_TABS.map((tab) => (
							<button
								key={tab.value}
								type="button"
								onClick={() => {
									setStatusFilter(tab.value);
									setPage(1);
								}}
								className={cn(
									'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
									statusFilter === tab.value
										? 'bg-[#64126D] text-white shadow-sm'
										: 'bg-white text-gray-600 border border-gray-200 hover:border-purple-200 hover:text-[#64126D]'
								)}
							>
								{tab.label}
							</button>
						))}
						<div className="flex items-center gap-1.5 ml-auto">
							<label className="text-xs text-gray-500">From</label>
							<Input
								type="date"
								value={from}
								onChange={(e) => {
									setFrom(e.target.value);
									setPage(1);
								}}
								className="h-8 text-xs w-36"
							/>
							<label className="text-xs text-gray-500">To</label>
							<Input
								type="date"
								value={to}
								onChange={(e) => {
									setTo(e.target.value);
									setPage(1);
								}}
								className="h-8 text-xs w-36"
							/>
						</div>
					</div>

					{/* Table */}
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 overflow-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Employee</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Dates</TableHead>
									<TableHead className="text-right">Days</TableHead>
									<TableHead>Reason</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Review</TableHead>
									{canApprove && (
										<TableHead className="text-right">Actions</TableHead>
									)}
								</TableRow>
							</TableHeader>
							<TableBody>
								{listQuery.isLoading ? (
									<TableRow>
										<TableCell {...({ colSpan: canApprove ? 8 : 7 } as object)}>
											<p className="text-center text-xs text-gray-400 py-6">
												Loading leave requests…
											</p>
										</TableCell>
									</TableRow>
								) : (listQuery.data?.length ?? 0) === 0 ? (
									<TableEmpty colSpan={canApprove ? 8 : 7}>
										<span className="inline-flex items-center gap-1.5">
											<CalendarDaysIcon className="w-4 h-4" />
											No leave applications found.
										</span>
									</TableEmpty>
								) : (
									(listQuery.data ?? []).map((row) => (
										<TableRow key={row.id}>
											<TableCell className="font-medium text-gray-900 whitespace-nowrap">
												{row.applicant_name ?? `User #${row.user_id}`}
											</TableCell>
											<TableCell className="whitespace-nowrap">
												{row.leave_type_name}
												<span
													className={cn(
														'ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
														Number(row.is_paid) === 1
															? 'bg-sky-100 text-sky-700'
															: 'bg-slate-100 text-slate-600'
													)}
												>
													{Number(row.is_paid) === 1 ? 'Paid' : 'Unpaid'}
												</span>
											</TableCell>
											<TableCell className="whitespace-nowrap text-xs">
												{formatDate(row.start_date)}
												{row.start_date !== row.end_date &&
													` – ${formatDate(row.end_date)}`}
												{Number(row.half_day) === 1 && (
													<span className="ml-1 text-[10px] text-gray-400">
														(half)
													</span>
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{Number(row.duration_days)}
											</TableCell>
											<TableCell
												className="max-w-56 truncate text-xs text-gray-600"
												title={row.reason ?? ''}
											>
												{row.reason ?? '—'}
											</TableCell>
											<TableCell>
												<span
													className={cn(
														'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
														STATUS_BADGE[row.status]
													)}
												>
													{row.status}
												</span>
											</TableCell>
											<TableCell className="text-xs text-gray-600 max-w-48">
												{row.status !== 'pending' ? (
													<span title={row.review_notes ?? ''}>
														{row.reviewer_name ?? '—'}
														{row.review_notes ? `: ${row.review_notes}` : ''}
													</span>
												) : (
													'—'
												)}
											</TableCell>
											{canApprove && (
												<TableCell className="text-right whitespace-nowrap">
													{row.status === 'pending' ? (
														<div className="inline-flex gap-1">
															<button
																type="button"
																title="Approve"
																disabled={reviewMutation.isPending}
																onClick={() => approve(row)}
																className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-40"
															>
																<CheckIcon className="w-4 h-4" />
															</button>
															<button
																type="button"
																title="Reject"
																disabled={reviewMutation.isPending}
																onClick={() => {
																	setRejectTarget(row);
																	setRejectNotes('');
																}}
																className="p-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40"
															>
																<XMarkIcon className="w-4 h-4" />
															</button>
														</div>
													) : row.status === 'approved' ? (
														<button
															type="button"
															title="Revoke approval (reopen as pending)"
															disabled={reviewMutation.isPending}
															onClick={() =>
																reviewMutation.mutate({
																	id: row.id,
																	status: 'pending',
																	review_notes: row.review_notes ?? undefined,
																})
															}
															className="text-[11px] font-medium text-purple-700 hover:underline disabled:opacity-40"
														>
															Revoke
														</button>
													) : null}
												</TableCell>
											)}
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{/* Pagination */}
					{listQuery.data && listQuery.data.length === PAGE_SIZE && (
						<div className="flex items-center justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Previous
							</Button>
							<span className="text-xs text-gray-500">Page {page}</span>
							<Button
								variant="outline"
								size="sm"
								disabled={(listQuery.data?.length ?? 0) < PAGE_SIZE}
								onClick={() => setPage((p) => p + 1)}
							>
								Next
							</Button>
						</div>
					)}
				</div>
			</div>

			{/* Reject modal — mandatory notes */}
			<Modal
				open={rejectTarget !== null}
				onClose={() => setRejectTarget(null)}
				title="Reject Leave Application"
				size="sm"
			>
				<div className="space-y-3">
					<p className="text-sm text-gray-600">
						Rejecting <strong>{rejectTarget?.applicant_name}</strong>&apos;s
						leave (
						{rejectTarget
							? `${formatDate(rejectTarget.start_date)} → ${formatDate(rejectTarget.end_date)}`
							: ''}
						). Please provide a reason — it will be shared with the employee.
					</p>
					<Textarea
						rows={3}
						value={rejectNotes}
						onChange={(e) => setRejectNotes(e.target.value)}
						placeholder="Reason for rejection…"
						required
					/>
					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => setRejectTarget(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={submitRejection}
							disabled={!rejectNotes.trim() || reviewMutation.isPending}
						>
							Reject Application
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
