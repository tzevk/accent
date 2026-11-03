import type { LeadAuditFilterDraft } from './types';

export const DEFAULT_DRAFT: LeadAuditFilterDraft = {
	preset: 'current_month',
	from: '',
	to: '',
	owner: '',
	source: '',
	sourceMissing: false,
	stage: '',
	priority: '',
	search: '',
};

export const PRESET_OPTIONS = [
	{ value: 'current_month', label: 'Current month to today' },
	{ value: 'previous_month', label: 'Previous month' },
	{ value: 'last_7_days', label: 'Last 7 days' },
	{ value: 'last_30_days', label: 'Last 30 days' },
	{ value: 'current_quarter', label: 'Current quarter to today' },
	{ value: 'current_year', label: 'Current year to today' },
	{ value: 'today', label: 'Today' },
	{ value: 'custom', label: 'Custom dates' },
] as const;

/** The query the server reads. Empty values are omitted, never sent as blanks. */
export function draftToQuery(
	draft: LeadAuditFilterDraft
): Record<string, string | undefined> {
	const query: Record<string, string | undefined> = {
		preset: draft.preset === 'custom' ? 'custom' : draft.preset,
		owner: draft.owner || undefined,
		source: draft.source || undefined,
		source_missing: draft.sourceMissing ? '1' : undefined,
		stage: draft.stage || undefined,
		priority: draft.priority || undefined,
		search: draft.search.trim() || undefined,
	};
	if (draft.preset === 'custom') {
		query.from_date = draft.from || undefined;
		query.to_date = draft.to || undefined;
	}
	return query;
}

export interface DraftValidation {
	valid: boolean;
	message: string;
}

export function validateDraft(draft: LeadAuditFilterDraft): DraftValidation {
	if (draft.preset !== 'custom') return { valid: true, message: '' };
	if (!draft.from || !draft.to) {
		return {
			valid: false,
			message: 'Choose both a start and an end date for a custom period.',
		};
	}
	if (draft.from > draft.to) {
		return {
			valid: false,
			message: 'The start date must be on or before the end date.',
		};
	}
	return { valid: true, message: '' };
}
