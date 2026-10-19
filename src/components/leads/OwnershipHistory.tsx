import type { OwnershipHistoryEntry } from '@/components/leads/types';
import { formatDateTime } from '@/lib/format';

interface OwnershipHistoryProps {
	history: OwnershipHistoryEntry[];
	ownerNameById?: Record<number, string>;
}

/**
 * Assignment audit trail. Historical actors stay explicit when unknown;
 * nothing invents a name for a missing actor reference.
 */
export default function OwnershipHistory({
	history,
	ownerNameById,
}: OwnershipHistoryProps) {
	const rows = Array.isArray(history) ? history : [];
	if (rows.length === 0) return null;
	const label = (userId: number | null): string => {
		if (userId === null || userId === undefined) return 'Unassigned intake';
		return ownerNameById?.[userId] ?? `User #${userId}`;
	};
	return (
		<section
			aria-label="Ownership history"
			className="rounded-lg border border-gray-200 bg-white p-6"
		>
			<h3 className="text-lg font-medium text-gray-900">Ownership history</h3>
			<ol className="mt-3 space-y-3">
				{rows.map((entry) => (
					<li key={entry.id} className="text-sm text-gray-700">
						<p>
							<span className="font-medium">
								{label(entry.prior_owner_user_id)}
							</span>
							<span aria-hidden="true"> → </span>
							<span className="font-medium">{label(entry.owner_user_id)}</span>
						</p>
						<p className="text-xs text-gray-500">
							Changed by{' '}
							{entry.actor_user_id === null || entry.actor_user_id === undefined
								? 'unknown actor'
								: (ownerNameById?.[entry.actor_user_id] ??
									`User #${entry.actor_user_id}`)}
							{entry.created_at ? ` · ${formatDateTime(entry.created_at)}` : ''}
						</p>
					</li>
				))}
			</ol>
		</section>
	);
}
