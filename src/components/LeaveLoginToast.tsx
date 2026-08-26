'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { apiGet } from '@/lib/api-client';
import {
	isDecisionToastShown,
	markDecisionToastShown,
	pickRecentDecision,
} from '@/lib/leave-display';

interface LeaveApplicationLite {
	id: number;
	status: string;
	reviewed_at?: string | null;
	review_notes?: string | null;
}

/**
 * Fires a one-time toast on login when a recent leave request was approved
 * or rejected (see DECISION_WINDOW_DAYS). Renders nothing.
 *
 * Shown-once tracking lives in sessionStorage, so the toast re-appears on
 * the next login/session but never repeats while navigating the app.
 */
export default function LeaveLoginToast() {
	const recent = useQuery<LeaveApplicationLite[]>({
		queryKey: ['leaves', 'decision-badge'],
		queryFn: async () => {
			const res = await apiGet<{ data?: LeaveApplicationLite[] }>(
				'/api/leaves',
				{
					scope: 'mine',
					limit: 5,
				}
			);
			return res.data ?? [];
		},
		staleTime: 60_000,
	});

	useEffect(() => {
		if (!recent.data || recent.data.length === 0) return;

		const decision = pickRecentDecision(recent.data);
		if (!decision || isDecisionToastShown(decision.id)) return;
		markDecisionToastShown(decision.id);

		const source = recent.data.find((app) => app.id === decision.id);
		const notes = source?.review_notes?.trim();

		if (decision.kind === 'approved') {
			toast.success('Your leave request was approved ✅', { duration: 5000 });
		} else {
			toast.error(
				notes
					? `Your leave request was rejected: ${notes.slice(0, 80)}${notes.length > 80 ? '…' : ''}`
					: 'Your leave request was rejected',
				{ duration: 5000 }
			);
		}
	}, [recent.data]);

	return null;
}
