import { describe, expect, it } from 'vitest';

import {
	LEAD_CONVERSION_FIELD_BY_MESSAGE,
	LEAD_CONVERSION_FOLLOW_UP_TYPES,
	LEAD_CONVERSION_MESSAGES,
	LEAD_CONVERSION_STAGE,
	canConvertLead,
	hasUsableContactDetails,
	leadConversionFollowUpDescription,
	leadConversionFollowUpType,
	leadConversionProposalPriority,
	leadConversionProposalTitle,
} from '@/lib/lead-conversion';
import { LEAD_STAGES } from '@/lib/lead-stages';

/**
 * The pure rules of the Lead-to-Proposal handoff (ticket #375): the stage
 * a conversion needs, the evidence the Proposal carries, and the work the
 * Proposal inherits. The server module asks these rules; it never decides
 * them on its own.
 */

describe('the stage a conversion needs', () => {
	it('converts only a Qualified Lead', () => {
		expect(LEAD_CONVERSION_STAGE).toBe('Qualified');
		expect(canConvertLead('Qualified')).toBe(true);
	});

	it('refuses every other stage, including an unresolved one', () => {
		for (const stage of LEAD_STAGES) {
			if (stage === 'Qualified') continue;
			expect(canConvertLead(stage)).toBe(false);
		}
		expect(canConvertLead(null)).toBe(false);
		expect(canConvertLead(undefined)).toBe(false);
		expect(canConvertLead('qualified')).toBe(false);
	});

	it('names the required stage in the refusal', () => {
		expect(LEAD_CONVERSION_MESSAGES.stage_required).toContain('Qualified');
	});
});

describe('the contact details of a conversion', () => {
	it('accepts a phone number', () => {
		expect(
			hasUsableContactDetails({
				phone: '+91 98765 43210',
				contact_email: null,
				inquiry_email: null,
				cc_emails: null,
			})
		).toBe(true);
	});

	it('accepts a real email address', () => {
		expect(
			hasUsableContactDetails({
				phone: null,
				contact_email: 'cleo@example.com',
				inquiry_email: null,
				cc_emails: null,
			})
		).toBe(true);
		expect(
			hasUsableContactDetails({
				phone: null,
				contact_email: null,
				inquiry_email: null,
				cc_emails: 'one@example.com, two@example.com',
			})
		).toBe(true);
	});

	it('refuses a missing or malformed address', () => {
		expect(
			hasUsableContactDetails({
				phone: null,
				contact_email: null,
				inquiry_email: null,
				cc_emails: null,
			})
		).toBe(false);
		expect(
			hasUsableContactDetails({
				phone: null,
				contact_email: 'not-an-address',
				inquiry_email: null,
				cc_emails: null,
			})
		).toBe(false);
	});
});

describe('the Proposal title of a converted Lead', () => {
	it('names the company and the project need', () => {
		expect(
			leadConversionProposalTitle({
				company_name: 'Cleo Infra',
				project_description: 'A plant extension',
			})
		).toBe('Cleo Infra — A plant extension');
	});

	it('falls back to the evidence the Lead carries', () => {
		expect(
			leadConversionProposalTitle({
				company_name: 'Cleo Infra',
				project_description: null,
			})
		).toBe('Cleo Infra');
		expect(
			leadConversionProposalTitle({
				company_name: null,
				project_description: 'A plant extension',
			})
		).toBe('A plant extension');
	});

	it('never invents a title it does not have', () => {
		expect(
			leadConversionProposalTitle({
				company_name: null,
				project_description: null,
			})
		).toBe('Converted enquiry');
	});
});

describe('the Proposal priority of a converted Lead', () => {
	it('translates the Lead priority once', () => {
		expect(leadConversionProposalPriority('High')).toBe('HIGH');
		expect(leadConversionProposalPriority('Medium')).toBe('MEDIUM');
		expect(leadConversionProposalPriority('Low')).toBe('LOW');
		expect(leadConversionProposalPriority(null)).toBe('MEDIUM');
	});
});

describe('the Proposal work a Lead task becomes', () => {
	it('keeps the kind of an outreach task', () => {
		expect(leadConversionFollowUpType('Call')).toBe('Call');
		expect(leadConversionFollowUpType('Email')).toBe('Email');
		expect(leadConversionFollowUpType('Meeting')).toBe('Meeting');
	});

	it('never labels a note or an unknown kind as outreach', () => {
		expect(leadConversionFollowUpType('Note')).toBe('Other');
		expect(leadConversionFollowUpType(null)).toBe('Other');
		expect(leadConversionFollowUpType('Site Visit')).toBe('Other');
	});

	it('uses only the kinds the Proposal follow-up table knows', () => {
		for (const kind of ['Call', 'Email', 'Meeting', 'Note', null]) {
			expect(LEAD_CONVERSION_FOLLOW_UP_TYPES).toContain(
				leadConversionFollowUpType(kind)
			);
		}
	});

	it('keeps the next-action text, then the notes, then a plain description', () => {
		expect(
			leadConversionFollowUpDescription('Send the offer', 'old notes')
		).toBe('Send the offer');
		expect(leadConversionFollowUpDescription(null, 'old notes')).toBe(
			'old notes'
		);
		expect(leadConversionFollowUpDescription('  ', null)).toBe(
			'Next follow-up'
		);
	});
});

describe('the refusals of a conversion', () => {
	it('gives every refusal a field to belong to', () => {
		for (const message of Object.values(LEAD_CONVERSION_MESSAGES)) {
			expect(LEAD_CONVERSION_FIELD_BY_MESSAGE[message]).toBeDefined();
		}
	});

	it('points the qualification refusals at their field', () => {
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[
				LEAD_CONVERSION_MESSAGES.contact_name_required
			]
		).toBe('contact_name');
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[
				LEAD_CONVERSION_MESSAGES.contact_details_required
			]
		).toBe('contact_details');
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[
				LEAD_CONVERSION_MESSAGES.project_need_required
			]
		).toBe('project_need');
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[LEAD_CONVERSION_MESSAGES.owner_required]
		).toBe('owner');
	});

	it('points the canonical-Proposal refusal at the Proposal', () => {
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[
				LEAD_CONVERSION_MESSAGES.conversion_conflict
			]
		).toBe('proposal');
		expect(
			LEAD_CONVERSION_FIELD_BY_MESSAGE[
				LEAD_CONVERSION_MESSAGES.proposal_link_conflict
			]
		).toBe('proposal');
	});
});
