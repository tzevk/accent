/**
 * Client-side helpers for leave UI decisions.
 */

export interface LeaveAppLike {
	id: number;
	status: string;
	reviewed_at?: string | null;
}

/** How long an approved/rejected decision stays highlighted on the tile. */
export const DECISION_WINDOW_DAYS = 7;

export type DecisionKind = 'approved' | 'rejected';

export interface RecentDecision {
	id: number;
	kind: DecisionKind;
	/** ISO date the decision was made. */
	reviewedAt: string;
}

function toTime(value?: string | null): number | null {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isNaN(t) ? null : t;
}

/**
 * Pick the most recent approved/rejected decision worth surfacing.
 *
 * - Ignores pending applications and reviews older than the window.
 * - Applications are assumed newest-first (API default ordering); among
 *   reviewed ones the newest reviewed_at wins.
 *
 * @param apps       applications, newest-first
 * @param now        reference time (injectable for tests)
 */
export function pickRecentDecision(
	apps: LeaveAppLike[] | undefined | null,
	now: Date = new Date()
): RecentDecision | null {
	if (!apps || apps.length === 0) return null;

	const windowMs = DECISION_WINDOW_DAYS * 86_400_000;
	const nowMs = now.getTime();
	let best: {
		id: number;
		kind: DecisionKind;
		reviewedAt: string;
		at: number;
	} | null = null;

	for (const app of apps) {
		if (app.status !== 'approved' && app.status !== 'rejected') continue;
		const at = toTime(app.reviewed_at);
		if (at === null) continue;
		if (nowMs - at > windowMs) continue;
		if (!best || at > best.at) {
			best = {
				id: app.id,
				kind: app.status,
				reviewedAt: app.reviewed_at as string,
				at,
			};
		}
	}

	return best
		? { id: best.id, kind: best.kind, reviewedAt: best.reviewedAt }
		: null;
}

const TOAST_SHOWN_KEY = 'leaves:decision-toast-shown-id';

/** Has the login toast for this decision already been shown this session? */
export function isDecisionToastShown(id: number): boolean {
	try {
		return window.sessionStorage.getItem(TOAST_SHOWN_KEY) === String(id);
	} catch {
		return false;
	}
}

/** Remember that the login toast for this decision has been shown. */
export function markDecisionToastShown(id: number): void {
	try {
		window.sessionStorage.setItem(TOAST_SHOWN_KEY, String(id));
	} catch {
		/* storage unavailable — worst case the toast repeats on navigation */
	}
}
