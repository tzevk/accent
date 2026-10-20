'use client';

import { useLeadTimeline } from '@/components/leads/queries';
import { formatDateTime } from '@/lib/format';

interface LeadTimelineProps {
	leadId: string;
	enabled: boolean;
}

const STATUS_TONES: Record<string, string> = {
	Scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
	Completed: 'bg-green-100 text-green-700 border-green-200',
	Cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
};

/**
 * The chronological Lead timeline. Completed work and scheduled work stay
 * distinguishable, and evidence that does not know its author or its
 * outcome says so instead of guessing.
 */
export default function LeadTimeline({ leadId, enabled }: LeadTimelineProps) {
	const timelineQuery = useLeadTimeline(leadId, enabled);
	const entries = timelineQuery.data?.data.entries ?? [];
	const loading = timelineQuery.isPending;
	const loadError =
		timelineQuery.error instanceof Error ? timelineQuery.error.message : null;

	return (
		<section
			aria-label="Lead timeline"
			className="rounded-lg border border-gray-200 bg-white p-6"
		>
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-lg font-medium text-gray-900">Timeline</h3>
				{loading ? (
					<span className="text-sm text-gray-500" role="status">
						Loading timeline…
					</span>
				) : null}
			</div>

			{loadError ? (
				<div role="alert" className="rounded-md bg-red-50 p-4">
					<p className="text-sm font-medium text-red-800">
						The timeline could not be loaded.
					</p>
					<p className="mt-1 text-sm text-red-700">{loadError}</p>
				</div>
			) : null}

			{!loadError && !loading && entries.length === 0 ? (
				<div className="py-6 text-center">
					<p className="text-sm font-medium text-gray-700">
						No activity recorded yet
					</p>
					<p className="mt-1 text-sm text-gray-500">
						Calls, emails, meetings, and notes appear here in the order they
						happened.
					</p>
				</div>
			) : null}

			{entries.length > 0 ? (
				<ol className="space-y-4">
					{entries.map((entry) => (
						<li key={entry.key} className="border-l-2 border-gray-200 pl-4">
							<div className="flex flex-wrap items-center gap-2">
								<p className="text-sm font-medium text-gray-900">
									{entry.title}
								</p>
								{entry.status ? (
									<span
										className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
											STATUS_TONES[entry.status] ??
											'bg-gray-100 text-gray-800 border-gray-200'
										}`}
									>
										{entry.status}
									</span>
								) : null}
								{entry.legacy ? (
									<span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-100 text-amber-800 border-amber-200">
										Legacy evidence
									</span>
								) : null}
							</div>
							{entry.detail ? (
								<p className="mt-1 text-sm text-gray-700 whitespace-pre-line">
									{entry.detail}
								</p>
							) : null}
							<p className="mt-1 text-xs text-gray-500">
								{entry.occurred_at
									? formatDateTime(entry.occurred_at)
									: entry.recorded_at
										? `Recorded ${formatDateTime(entry.recorded_at)}`
										: 'Date unknown'}
								{' · '}
								{entry.actor_name ? `by ${entry.actor_name}` : 'author unknown'}
								{entry.activity_type === 'Call' &&
								entry.status === 'Completed' &&
								!entry.call_outcome
									? ' · outcome unknown'
									: ''}
							</p>
						</li>
					))}
				</ol>
			) : null}
		</section>
	);
}
