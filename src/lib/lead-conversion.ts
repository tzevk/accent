import type { LeadStage } from '@/lib/lead-stages';

/**
 * The Lead-to-Proposal handoff vocabulary (ticket #375).
 *
 * Client-safe: this module has no server imports, so the interface, the
 * server workflow, and the tests share one vocabulary without a second
 * convention. Persistence authority stays with the server: this file only
 * says when a Lead may be converted, what the converted Proposal carries,
 * and where a refusal belongs.
 *
 * The rules:
 * - One enquiry has one canonical Proposal. A conversion never creates a
 *   second Proposal for an enquiry that already has one.
 * - A conversion needs a Qualified Lead with a named contact, a usable
 *   phone number or email address, a clear project need, and a resolved
 *   owner. Budget and timing are not Lead fields, so they never block a
 *   conversion.
 * - Converted is a handoff, never a sale won. The Proposal keeps its own
 *   status vocabulary.
 */

/** The one Lead stage a conversion starts from. */
export const LEAD_CONVERSION_STAGE: LeadStage = 'Qualified';

/**
 * The Proposal follow-up kinds. The Lead activity kinds map onto them:
 * a Call, an Email, and a Meeting keep their kind, and everything else
 * becomes Other, because the Proposal follow-up table has no note kind.
 */
export const LEAD_CONVERSION_FOLLOW_UP_TYPES = [
	'Call',
	'Email',
	'Meeting',
	'Site Visit',
	'Other',
] as const;

export type LeadConversionFollowUpType =
	(typeof LEAD_CONVERSION_FOLLOW_UP_TYPES)[number];

/**
 * Whether the Lead may be converted. Only a Qualified Lead may: an
 * unqualified enquiry has no Proposal yet, and a converted Lead already
 * has one.
 */
export function canConvertLead(
	stage: LeadStage | string | null | undefined
): boolean {
	return stage === LEAD_CONVERSION_STAGE;
}

/**
 * The Proposal follow-up kind of one Lead activity kind. The Lead kinds
 * Call, Email, and Meeting keep their kind. A Note and an unknown kind
 * become Other, so the Proposal work is never mislabelled as outreach.
 */
export function leadConversionFollowUpType(
	activityType: string | null | undefined
): LeadConversionFollowUpType {
	if (activityType === 'Call') return 'Call';
	if (activityType === 'Email') return 'Email';
	if (activityType === 'Meeting') return 'Meeting';
	return 'Other';
}

/**
 * The Proposal follow-up text of one scheduled Lead task: the next-action
 * text when the task carries one, the notes otherwise. A task with neither
 * keeps a plain description, so the Proposal work is never empty.
 */
export function leadConversionFollowUpDescription(
	nextAction: string | null | undefined,
	notes: string | null | undefined
): string {
	const action = (nextAction ?? '').trim();
	if (action !== '') return action;
	const note = (notes ?? '').trim();
	if (note !== '') return note;
	return 'Next follow-up';
}

/**
 * The Proposal title of a converted Lead. The Lead evidence names the
 * company and the project need; the title never invents a value it does
 * not have.
 */
export function leadConversionProposalTitle(lead: {
	company_name?: string | null;
	project_description?: string | null;
}): string {
	const company = (lead.company_name ?? '').trim();
	const need = (lead.project_description ?? '').trim();
	if (company !== '' && need !== '') return `${company} — ${need}`;
	if (company !== '') return company;
	if (need !== '') return need;
	return 'Converted enquiry';
}

/**
 * The Proposal priority of a converted Lead. The Lead priority is a title
 * case word and the Proposal priority is an upper case word, so the value
 * is translated once, here.
 */
export function leadConversionProposalPriority(
	priority: string | null | undefined
): 'LOW' | 'MEDIUM' | 'HIGH' {
	const value = (priority ?? '').trim().toLowerCase();
	if (value === 'high') return 'HIGH';
	if (value === 'low') return 'LOW';
	return 'MEDIUM';
}

/** The field of the conversion form a refusal belongs to. */
export type LeadConversionField =
	| 'stage'
	| 'contact_name'
	| 'contact_details'
	| 'project_need'
	| 'owner'
	| 'proposal_title'
	| 'notes'
	| 'proposal';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether the Lead carries a usable way to reach the client: a phone
 * number, or an email address that is a real address. Any one of them is
 * enough.
 */
export function hasUsableContactDetails(details: {
	phone?: string | null;
	contact_email?: string | null;
	inquiry_email?: string | null;
	cc_emails?: string | null;
}): boolean {
	if ((details.phone ?? '').trim() !== '') return true;
	for (const candidate of [details.contact_email, details.inquiry_email]) {
		const value = (candidate ?? '').trim();
		if (value !== '' && EMAIL_PATTERN.test(value)) return true;
	}
	for (const part of (details.cc_emails ?? '').split(',')) {
		const value = part.trim();
		if (value !== '' && EMAIL_PATTERN.test(value)) return true;
	}
	return false;
}

/**
 * The refusal messages of the conversion. One message per refusal, shared
 * by the server module and the interface, so the interface can attach the
 * refusal to the field it belongs to without guessing.
 */
export const LEAD_CONVERSION_MESSAGES = {
	stage_required:
		'Only a Qualified lead can be converted. Qualify the lead first.',
	lead_converted:
		'This lead is converted; the linked proposal holds the routine sales work.',
	contact_name_required: 'A converted proposal needs a named contact.',
	contact_details_required:
		'A converted proposal needs a usable phone number or email address.',
	project_need_required: 'A converted proposal needs a clear project need.',
	owner_required: 'This conversion needs a lead owner.',
	proposal_title_invalid: 'The proposal title must be 255 characters or fewer.',
	notes_invalid: 'The conversion notes must be 65535 characters or fewer.',
	conversion_conflict:
		'This enquiry has several linked proposals and no canonical choice. Resolve the canonical proposal in the legacy review panel first.',
	proposal_link_conflict:
		'The canonical lead link is not editable here. Convert the lead instead.',
} as const;

/**
 * The field every refusal message belongs to. The interface attaches a
 * refusal to its field through this map, so no refusal is shown as a
 * message without a home.
 */
export const LEAD_CONVERSION_FIELD_BY_MESSAGE: Readonly<
	Record<string, LeadConversionField>
> = {
	[LEAD_CONVERSION_MESSAGES.stage_required]: 'stage',
	[LEAD_CONVERSION_MESSAGES.lead_converted]: 'proposal',
	[LEAD_CONVERSION_MESSAGES.contact_name_required]: 'contact_name',
	[LEAD_CONVERSION_MESSAGES.contact_details_required]: 'contact_details',
	[LEAD_CONVERSION_MESSAGES.project_need_required]: 'project_need',
	[LEAD_CONVERSION_MESSAGES.owner_required]: 'owner',
	[LEAD_CONVERSION_MESSAGES.proposal_title_invalid]: 'proposal_title',
	[LEAD_CONVERSION_MESSAGES.notes_invalid]: 'notes',
	[LEAD_CONVERSION_MESSAGES.conversion_conflict]: 'proposal',
	[LEAD_CONVERSION_MESSAGES.proposal_link_conflict]: 'proposal',
};
