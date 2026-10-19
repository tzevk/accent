import { LeadWorkflowError } from '@/server/leads/shared';

/**
 * Helpers shared by the Lead request handlers: the id in the path and the
 * response shape of a refused workflow action.
 */

/** The numeric Lead id of a route path, or null when the path is not one. */
export function parseLeadId(value: string): number | null {
	const id = Number.parseInt(value, 10);
	return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A refused Lead action: the workflow error keeps its own status and code,
 * anything else is an unexpected failure.
 */
export function leadWorkflowFailure(
	error: unknown,
	fallback: string
): Response {
	if (error instanceof LeadWorkflowError) {
		return Response.json(
			{ success: false, error: error.message, code: error.code },
			{ status: error.status }
		);
	}
	console.error('Lead workflow error:', error);
	return Response.json({ success: false, error: fallback }, { status: 500 });
}
