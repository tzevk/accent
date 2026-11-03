import type { DbConnection } from '@/server/leads/shared';
import type {
	LeadAuditClock,
	LeadAuditEffectiveFilters,
	LeadAuditFilters,
	LeadAuditMeta,
	LeadAuditScope,
} from './types';

export const LEAD_AUDIT_DATE_BASIS =
	'Database calendar day (CURDATE()); both selected dates are included, and timestamp queries end at the next day 00:00:00.';

export function leadAuditStageLabel(value: string | null): string {
	return value ?? 'Unresolved (legacy evidence)';
}

export function buildLeadAuditMeta(clock: LeadAuditClock): LeadAuditMeta {
	return {
		generated_at: clock.generatedAt,
		today: clock.today,
		time_zone: {
			session: clock.timeZone.session,
			system: clock.timeZone.system,
			utc_offset: clock.timeZone.utcOffset,
			label: clock.timeZone.label,
		},
		live_data_warning:
			'Live corrected facts observed at generation time. Earlier periods can change when Lead facts are corrected; this is not an immutable issued report.',
		date_basis: LEAD_AUDIT_DATE_BASIS,
	};
}

export function buildLeadAuditScope(
	filters: LeadAuditFilters,
	effective: LeadAuditEffectiveFilters
): LeadAuditScope {
	return {
		preset: filters.preset,
		from_date: filters.fromDate,
		to_date: filters.toDate,
		date_basis: LEAD_AUDIT_DATE_BASIS,
		effective_filters: effective,
	};
}

/**
 * Resolve the applied filters into what the reader sees. A selected owner id
 * is named from the user record even when that account is inactive; a
 * deleted or missing account is shown as an unknown user reference rather
 * than borrowed from another person or silently dropped.
 */
export async function resolveLeadAuditEffectiveFilters(
	db: DbConnection,
	filters: LeadAuditFilters
): Promise<LeadAuditEffectiveFilters> {
	let ownerLabel = 'All owners';
	let ownerValue: string | null = null;
	if (filters.ownerUnassigned) {
		ownerValue = 'unassigned';
		ownerLabel = 'Unassigned';
	} else if (filters.ownerUserId !== null) {
		ownerValue = String(filters.ownerUserId);
		const [rows] = (await db.execute(
			`SELECT COALESCE(NULLIF(TRIM(full_name), ''), username) AS name
         FROM users WHERE id = ? LIMIT 1`,
			[filters.ownerUserId]
		)) as unknown as [Array<{ name: string | null }>, unknown];
		const name = rows[0]?.name;
		ownerLabel = name ? String(name) : `Unknown user #${filters.ownerUserId}`;
	}

	const source = filters.sourceMissing
		? { value: null, label: 'Unknown source', is_unknown: true }
		: filters.source !== null
			? { value: filters.source, label: filters.source, is_unknown: false }
			: { value: null, label: 'All sources', is_unknown: false };

	const stage =
		filters.stage === null
			? { value: null, label: 'All stages' }
			: {
					value: filters.stage,
					label:
						filters.stage === 'unresolved'
							? leadAuditStageLabel(null)
							: filters.stage,
				};

	return {
		owner: { value: ownerValue, label: ownerLabel },
		source,
		stage,
		priority: filters.priority,
		search: filters.search,
	};
}
