/**
 * The evidence filters shared by the Work and the Audit evidence sections
 * (#400, #404).
 *
 * These four filters describe one recorded activity evidence row, not a
 * Lead: who recorded it, what kind of work it was, what the attempt
 * achieved, and which supported evidence event it belongs to. The Lead
 * population filters (period, owner, source, stage, priority, search) stay
 * in `filters.ts`, because the intake section must never be narrowed by an
 * evidence filter.
 *
 * `unknown` is a first-class choice, not a wildcard: legacy activity rows
 * genuinely do not know their type, outcome, or author, and the report has
 * to be able to select them without guessing a canonical value.
 */
import {
	LEAD_ACTIVITY_TYPES,
	LEAD_CALL_OUTCOMES,
} from '@/lib/lead-activities';
import type { DbConnection } from '@/server/leads/shared';
import { LeadAuditValidationError } from './types';

export type EvidenceQuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

/** The email outcomes the report reads out of `reply_confirmed`. */
export const LEAD_AUDIT_EMAIL_OUTCOMES = [
	'email_replied',
	'email_sent',
] as const;

/**
 * Every allowed outcome filter: the canonical call outcomes, the two email
 * outcomes the activity log derives from `reply_confirmed`, and the explicit
 * unknown choice. An outcome filter applies to Call and Email rows only; a
 * Meeting, a Note, and an unknown type carry no outcome by design.
 */
export const LEAD_AUDIT_OUTCOME_FILTERS = [
	...LEAD_CALL_OUTCOMES,
	...LEAD_AUDIT_EMAIL_OUTCOMES,
	'unknown',
] as const;

export type LeadAuditOutcomeFilter =
	(typeof LEAD_AUDIT_OUTCOME_FILTERS)[number];

/**
 * The supported evidence event types: the audit view's event vocabulary.
 * A work read accepts the filter and reports it as ignored, because work
 * rows are activities, not evidence events.
 */
export const LEAD_AUDIT_EVENT_TYPES = [
	'activity',
	'stage_change',
	'owner_change',
	'correction',
	'conversion',
	'legacy_review',
	'deleted_record',
] as const;

export type LeadAuditEventTypeFilter =
	| (typeof LEAD_AUDIT_EVENT_TYPES)[number]
	| 'unknown';

export type LeadAuditActorFilter =
	| { kind: 'all' }
	| { kind: 'user'; userId: number }
	| { kind: 'unknown' };

export type LeadAuditActivityTypeFilter =
	| (typeof LEAD_ACTIVITY_TYPES)[number]
	| 'unknown';

export interface LeadAuditEvidenceFilters {
	actor: LeadAuditActorFilter;
	activityType: LeadAuditActivityTypeFilter | null;
	outcome: LeadAuditOutcomeFilter | null;
	eventType: LeadAuditEventTypeFilter | null;
	/**
	 * The audit population toggle: include undated evidence in the audit
	 * view. Work lists it as an ignored filter instead of pretending it
	 * narrows the dated work figures.
	 */
	undated: boolean;
}

export const LEAD_AUDIT_ALL_EVIDENCE_FILTERS: LeadAuditEvidenceFilters = {
	actor: { kind: 'all' },
	activityType: null,
	outcome: null,
	eventType: null,
	undated: false,
};

/** The resolved labels of the applied evidence filters. */
export interface LeadAuditEvidenceEffectiveFilters {
	actor: { value: string | null; label: string; is_unknown: boolean };
	activity_type: { value: string | null; label: string; is_unknown: boolean };
	outcome: { value: string | null; label: string; is_unknown: boolean };
	event_type: { value: string | null; label: string; is_unknown: boolean };
}

export type LeadAuditEvidenceFilterKey =
	| 'actor'
	| 'activity_type'
	| 'outcome'
	| 'event_type'
	| 'undated';

const OUTCOME_LABELS: Record<LeadAuditOutcomeFilter, string> = {
	Connected: 'Connected',
	'No Answer': 'No Answer',
	Busy: 'Busy',
	Voicemail: 'Voicemail',
	'Wrong Number': 'Wrong Number',
	email_replied: 'Email reply confirmed',
	email_sent: 'Email sent without a confirmed reply',
	unknown: 'Unknown outcome',
};

const EVENT_LABELS: Record<LeadAuditEventTypeFilter, string> = {
	activity: 'Activity',
	stage_change: 'Stage change',
	owner_change: 'Owner change',
	correction: 'Correction',
	conversion: 'Conversion',
	legacy_review: 'Legacy review',
	deleted_record: 'Deleted record',
	unknown: 'Unknown event type',
};

function readRaw(source: EvidenceQuerySource, key: string): string {
	if (source instanceof URLSearchParams) return source.get(key) ?? '';
	const value = source[key];
	return value === null || value === undefined ? '' : String(value);
}

function read(source: EvidenceQuerySource, key: string): string {
	return readRaw(source, key).trim();
}

function fail(code: string, message: string): never {
	throw new LeadAuditValidationError(code, message);
}

/**
 * One parser for the evidence filters. A closed vocabulary is refused with a
 * named code so a typo can never read as an empty population.
 */
export function parseLeadAuditEvidenceFilters(
	source: EvidenceQuerySource
): LeadAuditEvidenceFilters {
	const rawActor = read(source, 'actor').toLowerCase();
	let actor: LeadAuditActorFilter = { kind: 'all' };
	if (rawActor !== '' && rawActor !== 'all') {
		if (rawActor === 'unknown') {
			actor = { kind: 'unknown' };
		} else if (/^\d+$/.test(rawActor) && Number(rawActor) > 0) {
			actor = { kind: 'user', userId: Number(rawActor) };
		} else {
			fail('invalid_actor', `Invalid actor filter: ${rawActor}`);
		}
	}

	const rawActivityType = read(source, 'activity_type');
	let activityType: LeadAuditActivityTypeFilter | null = null;
	if (rawActivityType !== '' && rawActivityType !== 'all') {
		if (
			rawActivityType === 'unknown' ||
			(LEAD_ACTIVITY_TYPES as readonly string[]).includes(rawActivityType)
		) {
			activityType = rawActivityType as LeadAuditActivityTypeFilter;
		} else {
			fail(
				'invalid_activity_type',
				`Unknown Lead activity type filter: ${rawActivityType}`
			);
		}
	}

	const rawOutcome = read(source, 'outcome');
	let outcome: LeadAuditOutcomeFilter | null = null;
	if (rawOutcome !== '' && rawOutcome !== 'all') {
		if ((LEAD_AUDIT_OUTCOME_FILTERS as readonly string[]).includes(rawOutcome)) {
			outcome = rawOutcome as LeadAuditOutcomeFilter;
		} else {
			fail('invalid_outcome', `Unknown Lead outcome filter: ${rawOutcome}`);
		}
	}

	const rawEventType = read(source, 'event_type');
	let eventType: LeadAuditEventTypeFilter | null = null;
	if (rawEventType !== '' && rawEventType !== 'all') {
		if (
			rawEventType === 'unknown' ||
			(LEAD_AUDIT_EVENT_TYPES as readonly string[]).includes(rawEventType)
		) {
			eventType = rawEventType as LeadAuditEventTypeFilter;
		} else {
			fail('invalid_event_type', `Unknown evidence event filter: ${rawEventType}`);
		}
	}

	const rawUndated = read(source, 'undated').toLowerCase();

	return {
		actor,
		activityType,
		outcome,
		eventType,
		undated: rawUndated === '1' || rawUndated === 'true',
	};
}

/** True when the caller narrowed something an evidence section can honour. */
export function hasLeadAuditEvidenceFilters(
	filters: LeadAuditEvidenceFilters
): boolean {
	return (
		filters.actor.kind !== 'all' ||
		filters.activityType !== null ||
		filters.outcome !== null ||
		filters.eventType !== null ||
		filters.undated
	);
}

/** The filter value as the query carried it, for scope display and exports. */
export function leadAuditEvidenceFilterValue(
	filters: LeadAuditEvidenceFilters,
	key: LeadAuditEvidenceFilterKey
): string | null {
	switch (key) {
		case 'actor':
			return filters.actor.kind === 'all'
				? null
				: filters.actor.kind === 'unknown'
					? 'unknown'
					: String(filters.actor.userId);
		case 'activity_type':
			return filters.activityType;
		case 'outcome':
			return filters.outcome;
		case 'event_type':
			return filters.eventType;
		case 'undated':
			return filters.undated ? '1' : null;
		default: {
			const unreachable: never = key;
			throw new Error(`Unknown evidence filter: ${unreachable}`);
		}
	}
}

/**
 * Resolve the applied evidence filters into what the reader sees. A selected
 * author id is named from the user record even when the account is inactive,
 * because work recorded by a person who has since left is still that
 * person's work. A missing account is a retained reference, not a fabricated
 * name.
 */
export async function resolveLeadAuditEvidenceEffectiveFilters(
	db: DbConnection,
	filters: LeadAuditEvidenceFilters
): Promise<LeadAuditEvidenceEffectiveFilters> {
	let actor: LeadAuditEvidenceEffectiveFilters['actor'];
	if (filters.actor.kind === 'unknown') {
		actor = {
			value: 'unknown',
			label: 'Unknown author',
			is_unknown: true,
		};
	} else if (filters.actor.kind === 'user') {
		const userId = filters.actor.userId;
		const [rows] = (await db.execute(
			`SELECT COALESCE(NULLIF(TRIM(full_name), ''), username) AS name
         FROM users WHERE id = ? LIMIT 1`,
			[userId]
		)) as unknown as [Array<{ name: string | null }>, unknown];
		const name = rows[0]?.name;
		actor = {
			value: String(userId),
			label: name ? String(name) : `Unknown user #${userId}`,
			is_unknown: false,
		};
	} else {
		actor = { value: null, label: 'All authors', is_unknown: false };
	}

	const activityType: LeadAuditEvidenceEffectiveFilters['activity_type'] =
		filters.activityType === null
			? { value: null, label: 'All activity types', is_unknown: false }
			: filters.activityType === 'unknown'
				? {
						value: 'unknown',
						label: 'Unknown activity type',
						is_unknown: true,
					}
				: {
						value: filters.activityType,
						label: filters.activityType,
						is_unknown: false,
					};

	const outcome: LeadAuditEvidenceEffectiveFilters['outcome'] =
		filters.outcome === null
			? { value: null, label: 'All outcomes', is_unknown: false }
			: {
					value: filters.outcome,
					label: OUTCOME_LABELS[filters.outcome],
					is_unknown: filters.outcome === 'unknown',
				};

	const eventType: LeadAuditEvidenceEffectiveFilters['event_type'] =
		filters.eventType === null
			? { value: null, label: 'All event types', is_unknown: false }
			: {
					value: filters.eventType,
					label: EVENT_LABELS[filters.eventType],
					is_unknown: filters.eventType === 'unknown',
				};

	return { actor, activity_type: activityType, outcome, event_type: eventType };
}
