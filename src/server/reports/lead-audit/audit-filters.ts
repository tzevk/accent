/**
 * Audit-section filters that the shared evidence parser does not own.
 *
 * The actor, activity-type, outcome, and event-type vocabulary is parsed by
 * `evidence-filters.ts` (shared with the work section). This module adds the
 * audit-only `undated` switch, the SQL shapes for those filters, and the
 * explicit effective/ignored scope the audit view displays.
 */
import {
	LEAD_ACTIVITY_TYPES,
	LEAD_CALL_OUTCOMES,
	type LeadActivityType,
} from '@/lib/lead-activities';
import { nextDay } from './period';
import {
	buildLeadAuditFilterCondition,
	type SqlCondition,
} from './sql';
import {
	LEAD_AUDIT_EVIDENCE_OUTCOME_OPTIONS,
	LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS,
	LEAD_AUDIT_EVIDENCE_TYPES,
	type LeadAuditEvidenceType,
} from './audit-types';
import type { LeadAuditEvidenceFilters } from './evidence-filters';
import {
	LeadAuditValidationError,
	type LeadAuditFilters,
} from './types';

export function isSupportedAuditEventType(
	value: string
): value is LeadAuditEvidenceType {
	return (LEAD_AUDIT_EVIDENCE_TYPES as readonly string[]).includes(value);
}

/**
 * The shared parser accepts the superset used by every report section. The
 * audit list only has six event populations; a deleted-record or unknown
 * event type is refused with a named code instead of returning a silently
 * empty success.
 */
export function assertAuditEventType(
	eventType: LeadAuditEvidenceFilters['eventType']
): LeadAuditEvidenceType | null {
	if (eventType === null) return null;
	if (eventType === 'deleted_record') {
		throw new LeadAuditValidationError(
			'invalid_event_type',
			'Deleted records are a separate audit population; read /api/reports/lead-audit/audit/deleted instead'
		);
	}
	if (!isSupportedAuditEventType(eventType)) {
		throw new LeadAuditValidationError(
			'invalid_event_type',
			`Unknown audit evidence event type: ${eventType}`
		);
	}
	return eventType;
}

/**
 * Activity and outcome filters only speak about activity evidence. Combining
 * one of them with a non-activity event type can never match, so the read
 * refuses it rather than presenting an unexplained empty table.
 */
export function assertAuditEvidenceFilterCompatibility(
	filters: LeadAuditEvidenceFilters,
	eventType: LeadAuditEvidenceType | null
): void {
	if (
		(filters.activityType !== null || filters.outcome !== null) &&
		eventType !== null &&
		eventType !== 'activity'
	) {
		throw new LeadAuditValidationError(
			'incompatible_filters',
			'Activity type and outcome filters apply to activity evidence only and cannot be combined with a non-activity event type'
		);
	}
}

export function leadAuditEvidenceTypeLabel(value: string): string {
	return (
		LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.find((option) => option.value === value)
			?.label ?? value
	);
}

export function leadAuditOutcomeLabel(value: string | null): string | null {
	if (value === null) return null;
	return (
		LEAD_AUDIT_EVIDENCE_OUTCOME_OPTIONS.find(
			(option) => option.value === value
		)?.label ?? value
	);
}

export function leadAuditActivityTypeLabel(value: string | null): string {
	if (value === null) return 'Unknown activity type';
	return (
		LEAD_AUDIT_EVIDENCE_ACTIVITY_TYPE_LABELS[
			value as LeadActivityType
		] ?? value
	);
}

const LEAD_AUDIT_EVIDENCE_ACTIVITY_TYPE_LABELS: Record<string, string> = {
	Call: 'Call',
	Email: 'Email',
	Meeting: 'Meeting',
	Note: 'Note',
	unknown: 'Unknown activity type',
};

const CANONICAL_CALL_OUTCOMES = LEAD_CALL_OUTCOMES;

const CANONICAL_ACTIVITY_TYPES = LEAD_ACTIVITY_TYPES as readonly string[];

/** The actor predicate over one evidence table's actor column. */
export function buildEvidenceActorCondition(
	column: string,
	filters: LeadAuditEvidenceFilters
): SqlCondition {
	if (filters.actor.kind === 'all') return { sql: '', params: [] };
	if (filters.actor.kind === 'unknown') {
		return { sql: `${column} IS NULL`, params: [] };
	}
	return { sql: `${column} = ?`, params: [filters.actor.userId] };
}

/**
 * The activity-type and outcome predicates. `unknown` means the stored value
 * is NULL or outside the canonical vocabulary; a sent email includes the
 * unconfirmed reply flag, while a confirmed reply is its own outcome.
 */
export function buildEvidenceActivityCondition(
	alias: string,
	filters: LeadAuditEvidenceFilters
): SqlCondition {
	const clauses: string[] = [];
	const params: unknown[] = [];

	if (filters.activityType === 'unknown') {
		clauses.push(
			`(${alias}.activity_type IS NULL OR ${alias}.activity_type NOT IN (${CANONICAL_ACTIVITY_TYPES.map(() => '?').join(', ')}))`
		);
		params.push(...CANONICAL_ACTIVITY_TYPES);
	} else if (filters.activityType !== null) {
		clauses.push(`${alias}.activity_type = ?`);
		params.push(filters.activityType);
	}

	if (filters.outcome === 'email_replied') {
		clauses.push(
			`${alias}.activity_type = 'Email' AND ${alias}.reply_confirmed = 1`
		);
	} else if (filters.outcome === 'email_sent') {
		clauses.push(
			`${alias}.activity_type = 'Email' AND (${alias}.reply_confirmed IS NULL OR ${alias}.reply_confirmed = 0)`
		);
	} else if (filters.outcome === 'unknown') {
		clauses.push(
			`${alias}.activity_type = 'Call' AND (${alias}.call_outcome IS NULL OR ${alias}.call_outcome NOT IN (${CANONICAL_CALL_OUTCOMES.map(() => '?').join(', ')}))`
		);
		params.push(...CANONICAL_CALL_OUTCOMES);
	} else if (filters.outcome !== null) {
		clauses.push(
			`${alias}.activity_type = 'Call' AND ${alias}.call_outcome = ?`
		);
		params.push(filters.outcome);
	}

	return { sql: clauses.join(' AND '), params };
}

/** Evidence recorded inside the selected calendar days, exclusive next day. */
export function evidenceRecordedInPeriod(
	recordedColumn: string,
	filters: LeadAuditFilters
): SqlCondition {
	return {
		sql: `${recordedColumn} >= ? AND ${recordedColumn} < ?`,
		params: [
			`${filters.fromDate} 00:00:00`,
			`${nextDay(filters.toDate)} 00:00:00`,
		],
	};
}

/**
 * Undated evidence is activity evidence with no occurrence time. It stays
 * inspectable through `undated=1`, but never enters occurrence-dated work
 * metrics.
 */
export function evidenceUndatedCondition(alias: string): SqlCondition {
	return { sql: `${alias}.occurred_at IS NULL`, params: [] };
}

const ACTIVE_LEAD_PREFIX = '(l.isDelete = 0 OR l.isDelete IS NULL)';

/**
 * The retained deleted population applies the same stored Lead filters and
 * search as the operational report, but reads `isDelete = 1` instead of the
 * active predicate. The selected period is deliberately not applied: a
 * deletion time was never recorded.
 */
export function buildDeletedLeadFilterCondition(
	filters: LeadAuditFilters
): SqlCondition {
	const active = buildLeadAuditFilterCondition(filters);
	const rest = active.sql.startsWith(ACTIVE_LEAD_PREFIX)
		? active.sql.slice(ACTIVE_LEAD_PREFIX.length).replace(/^\s*AND\s+/, '')
		: active.sql;
	return {
		sql: rest === '' ? 'l.isDelete = 1' : `l.isDelete = 1 AND ${rest}`,
		params: active.params,
	};
}

/** Labels for the activity-type filter options. */
export function buildActivityTypeFilterOptions(): Array<{
	value: string;
	label: string;
}> {
	return [
		...LEAD_ACTIVITY_TYPES.map((value) => ({
			value,
			label: LEAD_AUDIT_EVIDENCE_ACTIVITY_TYPE_LABELS[value],
		})),
		{ value: 'unknown', label: 'Unknown activity type' },
	];
}

export function buildOutcomeFilterOptions(): Array<{
	value: string;
	label: string;
}> {
	return LEAD_AUDIT_EVIDENCE_OUTCOME_OPTIONS.map((option) => ({
		value: option.value,
		label: option.label,
	}));
}

export function buildEventTypeFilterOptions(): Array<{
	value: string;
	label: string;
}> {
	return LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.map((option) => ({
		value: option.value,
		label: option.label,
	}));
}

export function leadAuditEvidenceActorValue(
	filters: LeadAuditEvidenceFilters
): {
	value: string | null;
	label: string;
	is_unknown: boolean;
} {
	if (filters.actor.kind === 'unknown') {
		return { value: 'unknown', label: 'Unknown actor', is_unknown: true };
	}
	if (filters.actor.kind === 'user') {
		return {
			value: String(filters.actor.userId),
			label: `User #${filters.actor.userId}`,
			is_unknown: false,
		};
	}
	return { value: null, label: 'All actors', is_unknown: false };
}

