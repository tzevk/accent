'use client';

import { useMemo, useState } from 'react';
import {
	useQuery,
	useMutation,
	useInfiniteQuery,
	useQueryClient,
} from '@tanstack/react-query';
import {
	CalendarDaysIcon,
	PlusIcon,
	TrashIcon,
	ArrowPathIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import Modal from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
	Input,
	Textarea,
	Select,
	FieldGroup,
} from '@/components/ui/form-fields';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

interface LeaveTypeBalance {
	id: number;
	name: string;
	code: string;
	is_paid: boolean;
	requires_balance: boolean;
	quota: number;
	total: number;
	used: number;
	remaining: number;
}

interface BalancesResponse {
	success: boolean;
	data: {
		year: number;
		types: LeaveTypeBalance[];
		totals: { total: number; used: number; balance: number };
	};
}

interface LeaveApplication {
	id: number;
	start_date: string;
	end_date: string;
	half_day: number | boolean;
	duration_days: number | string;
	reason: string | null;
	status: 'pending' | 'approved' | 'rejected';
	leave_type_name?: string;
	leave_type_code?: string;
	is_paid?: number | boolean;
	review_notes?: string | null;
	reviewer_name?: string | null;
}

const PAGE_SIZE = 20;

const STATUS_BADGE: Record<string, string> = {
	pending: 'bg-amber-100 text-amber-700',
	approved: 'bg-emerald-100 text-emerald-700',
	rejected: 'bg-red-100 text-red-700',
};

/** Mirrors the server-side inclusive day count (see leave-helpers.ts). */
function clientDuration(
	startDate: string,
	endDate: string,
	halfDay: boolean
): number {
	if (!startDate || !endDate) return 0;
	const start = Date.parse(`${startDate}T00:00:00Z`);
	const end = Date.parse(`${endDate}T00:00:00Z`);
	if (Number.isNaN(start) || Number.isNaN(end)) return 0;
	const days = Math.round((end - start) / 86_400_000) + 1;
	if (days <= 0) return 0;
	return halfDay && days === 1 ? 0.5 : days;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Full-page "My Leaves" manager — reached from the dashboard Leaves tile.
 * Balances header, apply dialog, and the complete application history.
 */
export default function LeaveApplications() {
	const queryClient = useQueryClient();
	const [applyOpen, setApplyOpen] = useState(false);
	const [form, setForm] = useState({
		leave_type_id: '',
		start_date: today(),
		end_date: today(),
		half_day: false,
		reason: '',
	});

	const balances = useQuery<BalancesResponse['data']>({
		queryKey: ['leaves', 'balances'],
		queryFn: async () => {
			const res = await apiGet<BalancesResponse>('/api/leaves/balances');
			return res.data;
		},
		staleTime: 30_000,
	});

	const history = useInfiniteQuery<LeaveApplication[]>({
		queryKey: ['leaves', 'mine'],
		queryFn: async ({ pageParam }) => {
			const res = await apiGet<{ data?: LeaveApplication[] }>('/api/leaves', {
				scope: 'mine',
				limit: PAGE_SIZE,
				page: pageParam,
			});
			return res.data ?? [];
		},
		initialPageParam: 1,
		getNextPageParam: (lastPage, allPages) =>
			lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
		staleTime: 30_000,
	});

	// All loaded pages flattened, newest-first within each page.
	const applications = useMemo(
		() => history.data?.pages.flat() ?? [],
		[history.data]
	);

	const applyMutation = useMutation({
		mutationFn: async () =>
			apiPost('/api/leaves', {
				leave_type_id: Number(form.leave_type_id),
				start_date: form.start_date,
				end_date: form.end_date,
				half_day: form.half_day,
				reason: form.reason,
			}),
		onSuccess: () => {
			toast.success('Leave application submitted');
			setApplyOpen(false);
			setForm((f) => ({
				...f,
				leave_type_id: '',
				reason: '',
				half_day: false,
			}));
			queryClient.invalidateQueries({ queryKey: ['leaves'] });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const withdrawMutation = useMutation({
		mutationFn: async (id: number) => apiDelete(`/api/leaves/${id}`),
		onSuccess: () => {
			toast.success('Application withdrawn');
			queryClient.invalidateQueries({ queryKey: ['leaves'] });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const balanceTypes = useMemo(
		() => balances.data?.types.filter((t) => t.requires_balance) ?? [],
		[balances.data]
	);

	const duration = clientDuration(
		form.start_date,
		form.end_date,
		form.half_day
	);
	const canSubmit =
		form.leave_type_id !== '' &&
		duration > 0 &&
		form.reason.trim().length > 0 &&
		!applyMutation.isPending;

	function resetAndClose() {
		setApplyOpen(false);
		applyMutation.reset();
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-bold text-gray-900">My Leaves</h2>
					<p className="text-sm text-gray-500 mt-0.5">
						{balances.data
							? `${balances.data.totals.used} day(s) used · ${balances.data.totals.balance} remaining in ${balances.data.year}`
							: 'Apply for leave and track your applications'}
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					className="bg-[#64126D] hover:bg-[#52105a] text-white"
					onClick={() => setApplyOpen(true)}
				>
					<PlusIcon className="w-4 h-4 mr-1" />
					Apply for Leave
				</Button>
			</div>

			{/* Balance chips */}
			{balances.isLoading ? (
				<div className="flex gap-2" aria-busy>
					{[0, 1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-16 flex-1 rounded-lg bg-gray-100 animate-pulse"
						/>
					))}
				</div>
			) : balances.isError ? (
				<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-center gap-2 text-sm text-red-700">
					<ExclamationCircleIcon className="h-5 w-5 shrink-0" />
					Could not load balances.
					<Button
						variant="outline"
						size="sm"
						onClick={() => balances.refetch()}
						className="ml-auto"
					>
						Retry
					</Button>
				</div>
			) : (
				balanceTypes.length > 0 && (
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
						{balanceTypes.map((type) => (
							<div
								key={type.id}
								className={cn(
									'rounded-lg border px-3 py-2.5 transition-colors',
									type.remaining === 0
										? 'border-red-200 bg-red-50'
										: 'border-purple-100 bg-purple-50/60'
								)}
							>
								<p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1 truncate">
									{type.name}
								</p>
								<p className="text-xl font-extrabold leading-tight text-gray-900 tabular-nums">
									{type.remaining}
									<span className="text-xs font-semibold text-gray-400 ml-0.5">
										/ {type.total || type.quota}
									</span>
								</p>
							</div>
						))}
					</div>
				)
			)}

			{/* Application history */}
			<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Dates</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="text-right">Days</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Review</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{history.isLoading ? (
							<TableRow>
								<TableCell {...({ colSpan: 7 } as object)}>
									<p className="text-center text-sm text-gray-400 py-8">
										Loading your applications…
									</p>
								</TableCell>
							</TableRow>
						) : history.isError ? (
							<TableRow>
								<TableCell {...({ colSpan: 7 } as object)}>
									<div className="flex items-center justify-center gap-2 py-6 text-sm text-red-600">
										<ExclamationCircleIcon className="h-5 w-5" />
										Could not load applications.
										<Button
											variant="outline"
											size="sm"
											onClick={() => history.refetch()}
										>
											Retry
										</Button>
									</div>
								</TableCell>
							</TableRow>
						) : applications.length === 0 ? (
							<TableEmpty colSpan={7}>
								<span className="inline-flex items-center gap-1.5">
									<CalendarDaysIcon className="w-4 h-4" />
									No leave applications yet — click “Apply for Leave” to submit
									your first request.
								</span>
							</TableEmpty>
						) : (
							applications.map((app) => (
								<TableRow key={app.id}>
									<TableCell className="whitespace-nowrap text-sm font-medium text-gray-900">
										{formatDate(app.start_date)}
										{app.start_date !== app.end_date &&
											` – ${formatDate(app.end_date)}`}
										{Number(app.half_day) === 1 && (
											<span className="ml-1 text-[11px] text-gray-400">
												(half)
											</span>
										)}
									</TableCell>
									<TableCell className="whitespace-nowrap text-sm">
										{app.leave_type_name ?? app.leave_type_code}
										<span
											className={cn(
												'ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
												Number(app.is_paid) === 1
													? 'bg-sky-100 text-sky-700'
													: 'bg-slate-100 text-slate-600'
											)}
										>
											{Number(app.is_paid) === 1 ? 'Paid' : 'Unpaid'}
										</span>
									</TableCell>
									<TableCell className="text-right tabular-nums text-sm">
										{Number(app.duration_days)}
									</TableCell>
									<TableCell
										className="max-w-56 truncate text-sm text-gray-600"
										title={app.reason ?? ''}
									>
										{app.reason ?? '—'}
									</TableCell>
									<TableCell>
										<span
											className={cn(
												'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
												STATUS_BADGE[app.status] ??
													'bg-slate-100 text-slate-700'
											)}
										>
											{app.status}
										</span>
									</TableCell>
									<TableCell className="text-xs text-gray-600 max-w-48">
										{app.status !== 'pending' ? (
											<span title={app.review_notes ?? ''}>
												{app.reviewer_name ?? '—'}
												{app.review_notes ? `: ${app.review_notes}` : ''}
											</span>
										) : (
											'—'
										)}
									</TableCell>
									<TableCell className="text-right">
										{app.status === 'pending' && (
											<button
												type="button"
												title="Withdraw application"
												disabled={withdrawMutation.isPending}
												onClick={() => withdrawMutation.mutate(app.id)}
												className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
											>
												{withdrawMutation.isPending ? (
													<ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
												) : (
													<TrashIcon className="h-3.5 w-3.5" />
												)}
												Withdraw
											</button>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{history.hasNextPage && (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
						disabled={history.isFetchingNextPage}
						onClick={() => history.fetchNextPage()}
					>
						{history.isFetchingNextPage ? (
							<ArrowPathIcon className="h-4 w-4 animate-spin mr-1" />
						) : null}
						Load more
					</Button>
				</div>
			)}

			{/* Apply modal */}
			<Modal
				open={applyOpen}
				onClose={resetAndClose}
				title="Apply for Leave"
				size="md"
			>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (canSubmit) applyMutation.mutate();
					}}
				>
					<FieldGroup label="Leave type" required>
						<Select
							value={form.leave_type_id}
							onChange={(e) =>
								setForm((f) => ({
									...f,
									leave_type_id: e.target.value,
									half_day: false,
								}))
							}
							required
						>
							<option value="">Select a leave type…</option>
							{(balances.data?.types ?? []).map((type) => (
								<option key={type.id} value={type.id}>
									{type.name}
									{type.requires_balance ? ` (${type.remaining} left)` : ''}
								</option>
							))}
						</Select>
					</FieldGroup>

					<div className="grid grid-cols-2 gap-3">
						<FieldGroup label="From" required>
							<Input
								type="date"
								value={form.start_date}
								min={today()}
								onChange={(e) =>
									setForm((f) => ({
										...f,
										start_date: e.target.value,
										end_date:
											f.end_date < e.target.value ? e.target.value : f.end_date,
									}))
								}
								required
							/>
						</FieldGroup>
						<FieldGroup label="To" required>
							<Input
								type="date"
								value={form.end_date}
								min={form.start_date || today()}
								onChange={(e) =>
									setForm((f) => ({ ...f, end_date: e.target.value }))
								}
								required
							/>
						</FieldGroup>
					</div>

					<div className="flex items-center justify-between gap-2">
						<label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
							<input
								type="checkbox"
								checked={form.half_day}
								disabled={form.start_date !== form.end_date}
								onChange={(e) =>
									setForm((f) => ({ ...f, half_day: e.target.checked }))
								}
								className="rounded border-gray-300 text-[#64126D] focus:ring-[#64126D]"
							/>
							Half day
						</label>
						<p
							className={cn(
								'text-xs font-semibold px-2 py-1 rounded-full tabular-nums',
								duration > 0
									? 'bg-purple-50 text-[#64126D]'
									: 'bg-gray-100 text-gray-400'
							)}
						>
							Duration:{' '}
							{duration > 0
								? `${duration} day${duration === 1 ? '' : 's'}`
								: '—'}
						</p>
					</div>

					<FieldGroup label="Reason" required>
						<Textarea
							rows={3}
							value={form.reason}
							onChange={(e) =>
								setForm((f) => ({ ...f, reason: e.target.value }))
							}
							placeholder="Briefly describe the reason for your leave…"
							required
						/>
					</FieldGroup>

					<div className="flex justify-end gap-2 pt-1">
						<Button type="button" variant="outline" onClick={resetAndClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!canSubmit}
							className="bg-[#64126D] hover:bg-[#52105a] text-white disabled:opacity-50"
						>
							{applyMutation.isPending ? (
								<ArrowPathIcon className="w-4 h-4 mr-1 animate-spin" />
							) : (
								<CalendarDaysIcon className="h-4 w-4 mr-1" />
							)}
							Submit Application
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
