'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellIcon } from '@heroicons/react/24/outline';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';

const POLL_MS = 60000;

/**
 * Older notification rows stored `1 day(s) … starting 2026-09-04`. Normalize
 * them at read time so the panel never shows a raw template.
 */
function normalizeLeaveBody(body) {
	if (!body) return body;
	const match = body.match(
		/^(.+?) requested ([\d.]+) day\(s\) of (.+?) starting (\d{4}-\d{2}-\d{2})$/
	);
	if (!match) return body;
	const [, name, rawDays, leaveType, startDate] = match;
	const count = Number(rawDays);
	return `${name} requested ${count} day${count === 1 ? '' : 's'} of ${leaveType} starting ${formatDate(startDate)}`;
}

/**
 * Header bell for leave management.
 * Badge shows pending leave count (live from leave_applications) — the
 * actionable queue — falling back to unread notification count.
 * Panel lists pending leaves first, then recent notifications.
 */
export default function NotificationsBell() {
	const router = useRouter();
	const { user, can } = useSessionRBAC();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState([]);
	const [unread, setUnread] = useState(0);
	const [pending, setPending] = useState([]);
	const [pendingCount, setPendingCount] = useState(0);
	const ref = useRef(null);

	// Only leave approvers ever have pending to manage (super_admin bypasses can()).
	const isApprover = can(RESOURCES.LEAVES, PERMISSIONS.APPROVE);

	const fetchNotifications = useCallback(async () => {
		try {
			const res = await apiGet('/api/notifications');
			if (res?.success) {
				setItems(res.data.notifications ?? []);
				setUnread(res.data.unread_count ?? 0);
				setPending(res.data.pending_leaves ?? []);
				setPendingCount(res.data.pending_count ?? 0);
			}
		} catch (error) {
			console.error('Failed to fetch notifications:', error);
		}
	}, []);

	useEffect(() => {
		if (!user) return;
		fetchNotifications();
		const interval = setInterval(fetchNotifications, POLL_MS);
		return () => clearInterval(interval);
	}, [user, fetchNotifications]);

	// Opening the panel marks notification rows read (pending stays until approved).
	useEffect(() => {
		if (!open || unread === 0) return;
		apiPost('/api/notifications').catch(() => {});
		setUnread(0);
	}, [open, unread]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e) => {
			if (ref.current && !ref.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	}, [open]);

	if (!isApprover) return null;

	const displayCount = pendingCount > 0 ? pendingCount : unread;
	const countLabel =
		pendingCount > 0
			? `${pendingCount} pending`
			: unread > 0
				? `${unread} unread`
				: '';
	const hasPending = pendingCount > 0;
	const hasItems = items.length > 0;
	const panelEdge =
		'fixed left-4 right-4 top-[4.5rem] z-50 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-border anim-drop sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-6 sm:w-96';

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={
					countLabel ? `Notifications, ${countLabel}` : 'Notifications'
				}
				aria-expanded={open}
				className="relative rounded-xl p-2 text-primary transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<BellIcon className="h-5 w-5" />
				{displayCount > 0 && (
					<span
						className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center"
						aria-hidden="true"
					>
						{displayCount > 99 ? '99+' : displayCount}
					</span>
				)}
			</button>

			{open && (
				<div className={panelEdge}>
					<div className="px-4 py-3 border-b border-border flex items-center justify-between">
						<span className="text-sm font-semibold text-foreground">
							Notifications
						</span>
						{hasPending ? (
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
								{pendingCount} pending
							</span>
						) : (
							<span className="text-xs text-muted-foreground">
								{items.length} total
							</span>
						)}
					</div>

					<div className="max-h-96 overflow-y-auto divide-y divide-border">
						{/* Pending leave requests — the actionable queue */}
						{hasPending ? (
							<div>
								<div className="px-4 pt-3 pb-1">
									<p className="text-xs font-semibold tracking-wider uppercase text-amber-700">
										Requires approval
									</p>
								</div>
								{pending.map((p) => (
									<button
										key={`pending-${p.id}`}
										type="button"
										onClick={() => {
											setOpen(false);
											router.push('/employees/leaves');
										}}
										className="w-full text-left px-4 py-3 hover:bg-amber-50/70 transition-colors"
									>
										<p className="text-sm font-medium text-gray-900 truncate">
											{p.applicant_name} — {p.leave_type_name}
											{p.leave_type_code ? ` (${p.leave_type_code})` : ''}
										</p>
										<p className="text-xs text-gray-600 mt-0.5">
											{formatDate(p.start_date)} → {formatDate(p.end_date)} ·{' '}
											{Number(p.duration_days)} day
											{Number(p.duration_days) !== 1 ? 's' : ''}
											{p.half_day ? ' (half-day)' : ''}
										</p>
										{p.reason && (
											<p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
												{p.reason}
											</p>
										)}
										<p className="text-xs text-muted-foreground mt-1">
											{formatDateTime(p.created_at)}
										</p>
									</button>
								))}
								{pendingCount > pending.length && (
									<button
										type="button"
										onClick={() => {
											setOpen(false);
											router.push('/employees/leaves');
										}}
										className="w-full px-4 py-2 text-xs font-medium text-[#64126D] hover:bg-purple-50 transition-colors"
									>
										View all {pendingCount} pending — manage in Leave Requests →
									</button>
								)}
							</div>
						) : (
							<div className="px-4 py-3">
								<p className="text-xs text-center text-muted-foreground">
									No pending leave requests
								</p>
							</div>
						)}

						{/* Recent notification history (fire-and-forget inserts on new requests) */}
						{hasItems && (
							<div>
								<div className="px-4 pt-3 pb-1">
									<p className="text-xs font-semibold tracking-wider uppercase text-gray-500">
										Recent
									</p>
								</div>
								{items.slice(0, 8).map((n) => {
									const body =
										n.type === 'leave_request'
											? normalizeLeaveBody(n.body)
											: n.body;
									return (
										<button
											key={n.id}
											type="button"
											onClick={() => {
												setOpen(false);
												router.push(n.link || '/employees/leaves');
											}}
											className="w-full text-left px-4 py-3 hover:bg-purple-50 transition-colors"
										>
											<p className="text-sm font-medium text-gray-900">
												{n.title}
											</p>
											{body && (
												<p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
													{body}
												</p>
											)}
											<p className="text-xs text-muted-foreground mt-1">
												{formatDateTime(n.created_at)}
											</p>
										</button>
									);
								})}
							</div>
						)}
					</div>

					<div className="px-4 py-2 bg-muted/60 border-t border-border flex justify-end">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								router.push('/employees/leaves');
							}}
							className="text-xs font-medium text-[#64126D] hover:text-[#4d025b]"
						>
							Manage in Leave Requests →
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
