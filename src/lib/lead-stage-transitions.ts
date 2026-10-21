import {
	isLeadOutreachType,
	type LeadActivityType,
	type LeadCallOutcome,
} from '@/lib/lead-activities';
import type { LeadStage } from '@/lib/lead-stages';

/**
 * The automatic stage decision (ticket #371).
 *
 * Pure, client-safe, and shared by the server workflow and the tests: the
 * server never decides a stage on its own, it asks this rule. Only forward
 * movement, only from the two early stages:
 *
 * - `New` + outreach (call, email, or meeting) → `Attempting Contact`.
 * - `New` or `Attempting Contact` + a connected call or a confirmed email
 *   reply → `Connected`.
 *
 * A note, a scheduled task, a sent-but-unconfirmed email, a failed call, and
 * every stage a human decided never move. The function returns the stage
 * that follows, or null when nothing changes.
 */

export interface AutomaticStageInput {
	/** The stage the Lead is in now; null = unresolved legacy stage. */
	currentStage: LeadStage | null;
	/** The kind of work just recorded; null = unknown kind (legacy row). */
	activityType: LeadActivityType | null;
	/** The call outcome, for a call. */
	callOutcome: LeadCallOutcome | null;
	/** Whether the client answered the email. */
	replyConfirmed: boolean | null;
}

export function resolveAutomaticStage(
	input: AutomaticStageInput
): LeadStage | null {
	const { currentStage } = input;
	if (currentStage !== 'New' && currentStage !== 'Attempting Contact') {
		return null;
	}
	if (!isLeadOutreachType(input.activityType)) return null;

	const connectedCall =
		input.activityType === 'Call' && input.callOutcome === 'Connected';
	const confirmedReply =
		input.activityType === 'Email' && input.replyConfirmed === true;
	if (connectedCall || confirmedReply) return 'Connected';

	// Every other outreach is an attempt: New becomes Attempting Contact,
	// Attempting Contact stays where it is.
	return currentStage === 'New' ? 'Attempting Contact' : null;
}
