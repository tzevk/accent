export interface LegacyReviewEvidence {
	legacy_review_required?: boolean | number | null;
	legacy_stage?: string | null;
	legacy_owner_name?: string | null;
}

/**
 * Visible review state for unresolved legacy values. Original evidence is
 * shown as-is.
 */
export default function LegacyReviewNotice({
	lead,
}: {
	lead: LegacyReviewEvidence;
}) {
	if (!lead.legacy_review_required) return null;
	return (
		<section
			aria-label="Legacy values need review"
			className="rounded-lg border border-amber-300 bg-amber-50 p-4"
		>
			<h3 className="text-sm font-semibold text-amber-900">
				Needs review — original values kept
			</h3>
			<dl className="mt-2 space-y-1 text-sm text-amber-900">
				{lead.legacy_stage ? (
					<div className="flex gap-2">
						<dt className="font-medium">Original stage:</dt>
						<dd>{lead.legacy_stage}</dd>
					</div>
				) : null}
				{lead.legacy_owner_name ? (
					<div className="flex gap-2">
						<dt className="font-medium">Original owner:</dt>
						<dd>{lead.legacy_owner_name}</dd>
					</div>
				) : null}
				{!lead.legacy_stage && !lead.legacy_owner_name ? (
					<p>No original values were recorded.</p>
				) : null}
			</dl>
			<p className="mt-2 text-xs text-amber-800">
				Nothing is merged or guessed. Original values stay visible.
			</p>
		</section>
	);
}
