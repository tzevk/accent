import { isLeadStage } from '@/lib/lead-stages';
import {
	isLeadAuditPreset,
	isValidIsoDate,
	resolvePresetRange,
	type LeadAuditPeriod,
} from './period';
import {
	LEAD_AUDIT_METRICS,
	LEAD_AUDIT_PRIORITIES,
	LeadAuditValidationError,
	type LeadAuditFilters,
	type LeadAuditMetric,
	type LeadAuditPagination,
	type LeadAuditPriority,
} from './types';

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

function readRaw(source: QuerySource, key: string): string {
	const value =
		source instanceof URLSearchParams ? source.get(key) : (source[key] ?? null);
	return typeof value === 'string' ? value : '';
}

function read(source: QuerySource, key: string): string {
	return readRaw(source, key).trim();
}

function fail(code: string, message: string): never {
	throw new LeadAuditValidationError(code, message);
}

/**
 * One parser for every report read. Closed vocabularies are refused with a
 * named code instead of silently matching nothing; source labels stay open
 * because they are stored free text.
 */
export function parseLeadAuditFilters(
	source: QuerySource,
	today: string
): LeadAuditFilters {
	const rawPreset = read(source, 'preset');
	if (rawPreset !== '' && !isLeadAuditPreset(rawPreset)) {
		fail('invalid_preset', `Unknown report period preset: ${rawPreset}`);
	}

	const from = read(source, 'from_date');
	const to = read(source, 'to_date');
	let period: LeadAuditPeriod;
	if (from !== '' || to !== '') {
		if (from === '' || to === '') {
			fail(
				'invalid_range',
				'Both from_date and to_date are required for a custom period'
			);
		}
		if (!isValidIsoDate(from)) {
			fail('invalid_date', `Invalid from_date: ${from} (expected YYYY-MM-DD)`);
		}
		if (!isValidIsoDate(to)) {
			fail('invalid_date', `Invalid to_date: ${to} (expected YYYY-MM-DD)`);
		}
		if (from > to) {
			fail('invalid_range', 'from_date must not be later than to_date');
		}
		period = { preset: 'custom' as const, fromDate: from, toDate: to };
	} else {
		const preset = rawPreset === '' ? 'current_month' : rawPreset;
		if (preset === 'custom') {
			fail(
				'invalid_range',
				'Custom periods require from_date and to_date'
			);
		}
		period = resolvePresetRange(preset, today);
	}

	const rawOwner = read(source, 'owner');
	let ownerUserId: number | null = null;
	let ownerUnassigned = false;
	if (rawOwner !== '' && rawOwner !== 'all') {
		if (rawOwner === 'unassigned') {
			ownerUnassigned = true;
		} else if (/^\d+$/.test(rawOwner) && Number(rawOwner) > 0) {
			ownerUserId = Number(rawOwner);
		} else {
			fail('invalid_owner', `Invalid owner filter: ${rawOwner}`);
		}
	}

	const sourceLabel = readRaw(source, 'source');
	const rawSourceMissing = read(source, 'source_missing');
	const sourceMissing =
		rawSourceMissing === '1' || rawSourceMissing.toLowerCase() === 'true';
	if (sourceLabel !== '' && sourceLabel !== 'all' && sourceMissing) {
		fail(
			'invalid_source',
			'Choose either an exact source label or the missing-source filter'
		);
	}

	const rawStage = read(source, 'stage');
	let stage: LeadAuditFilters['stage'] = null;
	if (rawStage !== '' && rawStage !== 'all') {
		if (rawStage === 'unresolved' || isLeadStage(rawStage)) {
			stage = rawStage;
		} else {
			fail('invalid_stage', `Unknown Lead stage filter: ${rawStage}`);
		}
	}

	const rawPriority = read(source, 'priority');
	let priority: LeadAuditPriority | null = null;
	if (rawPriority !== '' && rawPriority !== 'all') {
		if ((LEAD_AUDIT_PRIORITIES as readonly string[]).includes(rawPriority)) {
			priority = rawPriority as LeadAuditPriority;
		} else {
			fail('invalid_priority', `Unknown Lead priority: ${rawPriority}`);
		}
	}

	return {
		preset: period.preset,
		fromDate: period.fromDate,
		toDate: period.toDate,
		ownerUserId,
		ownerUnassigned,
		source:
			sourceLabel === '' || sourceLabel === 'all' ? null : sourceLabel,
		sourceMissing,
		stage,
		priority,
		search: read(source, 'search'),
	};
}

export function parseLeadAuditPagination(
	source: QuerySource
): LeadAuditPagination {
	const parsedPage = Number.parseInt(read(source, 'page'), 10);
	const parsedLimit = Number.parseInt(read(source, 'limit'), 10);
	return {
		page:
			Number.isInteger(parsedPage) && parsedPage > 0
				? Math.min(parsedPage, 1_000_000)
				: 1,
		limit:
			Number.isInteger(parsedLimit) && parsedLimit > 0
				? Math.min(parsedLimit, 100)
				: 25,
	};
}

export function parseLeadAuditMetric(source: QuerySource): LeadAuditMetric {
	const raw = read(source, 'metric');
	if (raw === '') return 'recorded';
	if ((LEAD_AUDIT_METRICS as readonly string[]).includes(raw)) {
		return raw as LeadAuditMetric;
	}
	fail('invalid_metric', `Unknown report evidence metric: ${raw}`);
}
