import { describe, expect, it } from 'vitest';
import {
	LEAD_PROGRESS_MESSAGES,
	leadNextActionOwner,
	leadProjectLinkState,
	leadProposalLinkState,
} from '@/lib/lead-progress';

/**
 * The downstream rules of ticket #376.
 *
 * The seam is the link decision of a converted Lead: the state of the
 * canonical Proposal link, the state of the Project link behind it, and
 * the owner of the next action. The Lead detail read applies these rules,
 * and the integration harness proves the same states over real HTTP.
 */
describe('leadProposalLinkState', () => {
	it('has no downstream details while the enquiry carries no Proposal', () => {
		expect(
			leadProposalLinkState({
				canonical_proposal_id: null,
				linked_proposal_count: 0,
				can_read_proposals: true,
			})
		).toBe('none');
	});

	it('leaves a linked but unchosen Proposal unresolved', () => {
		expect(
			leadProposalLinkState({
				canonical_proposal_id: null,
				linked_proposal_count: 2,
				can_read_proposals: true,
			})
		).toBe('unresolved');
	});

	it('restricts the details of a Proposal the reader may not read', () => {
		expect(
			leadProposalLinkState({
				canonical_proposal_id: 42,
				linked_proposal_count: 1,
				can_read_proposals: false,
			})
		).toBe('restricted');
	});

	it('exposes the details of the canonical Proposal to a permitted reader', () => {
		expect(
			leadProposalLinkState({
				canonical_proposal_id: 42,
				linked_proposal_count: 1,
				can_read_proposals: true,
			})
		).toBe('available');
	});
});

describe('leadProjectLinkState', () => {
	it('has no Project while the Proposal links to none', () => {
		expect(
			leadProjectLinkState({ project_id: null, can_read_projects: true })
		).toBe('none');
	});

	it('restricts a Project the reader may not read', () => {
		expect(
			leadProjectLinkState({ project_id: 7, can_read_projects: false })
		).toBe('restricted');
	});

	it('exposes a Project to a permitted reader', () => {
		expect(
			leadProjectLinkState({ project_id: 7, can_read_projects: true })
		).toBe('available');
	});
});

describe('leadNextActionOwner', () => {
	it('gives the next action of a converted Lead to its Proposal', () => {
		expect(leadNextActionOwner('Converted')).toBe('proposal');
	});

	it('keeps the next action of every other Lead with the Lead', () => {
		expect(leadNextActionOwner('Qualified')).toBe('lead');
		expect(leadNextActionOwner('Attempting Contact')).toBe('lead');
		expect(leadNextActionOwner(null)).toBe('lead');
	});
});

describe('LEAD_PROGRESS_MESSAGES', () => {
	it('tells the four downstream states apart', () => {
		const none = LEAD_PROGRESS_MESSAGES.none;
		const unresolved = LEAD_PROGRESS_MESSAGES.unresolved;
		const restricted = LEAD_PROGRESS_MESSAGES.restricted;
		const projectRestricted = LEAD_PROGRESS_MESSAGES.project_restricted;
		const noProject = LEAD_PROGRESS_MESSAGES.no_project;

		expect(none).not.toBe(unresolved);
		expect(unresolved).not.toBe(restricted);
		expect(restricted).not.toBe(projectRestricted);
		expect(projectRestricted).not.toBe(noProject);
		expect(none.trim()).not.toBe('');
		expect(unresolved.trim()).not.toBe('');
		expect(restricted.trim()).not.toBe('');
		expect(projectRestricted.trim()).not.toBe('');
		expect(noProject.trim()).not.toBe('');
	});
});
