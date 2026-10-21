import { cn } from '@/lib/cn';

const STAGE_TONES: Record<string, string> = {
	New: 'bg-blue-100 text-blue-800',
	'Attempting Contact': 'bg-amber-100 text-amber-800',
	Connected: 'bg-cyan-100 text-cyan-800',
	Qualified: 'bg-green-100 text-green-800',
	Nurture: 'bg-purple-100 text-purple-800',
	Disqualified: 'bg-gray-200 text-gray-800',
	Converted: 'bg-emerald-100 text-emerald-800',
};

interface LeadStageBadgeProps {
	stage: string | null | undefined;
}

/**
 * Canonical Lead Stage badge. A NULL stage means the stored value could not
 * be resolved to the canonical vocabulary, so it renders as "Needs review"
 * instead of guessing a stage.
 */
export default function LeadStageBadge({ stage }: LeadStageBadgeProps) {
	if (!stage) {
		return (
			<span
				title="Unresolved stage — the original value is kept for review"
				className={cn(
					'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
					'bg-amber-100 text-amber-900'
				)}
			>
				Needs review
			</span>
		);
	}
	const tone = STAGE_TONES[stage] ?? 'bg-gray-100 text-gray-800';
	return (
		<span
			className={cn(
				'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
				tone
			)}
		>
			{stage}
		</span>
	);
}
