/**
 * The shared Project Lead policy.
 *
 * One policy applies to every project. Each work section is `hidden`, `view`
 * (read-only), or `edit` for every Project Lead. A stored policy is the only
 * source of lead section rights; per-project and per-user overrides do not
 * exist, and explicit grants stay additive in `policy.ts`.
 *
 * This module is pure: no database access, no server-only imports.
 */

import {
	WORK_SECTION_IDS,
	type LeadSectionSetting,
	type SectionId,
} from './sections';

export type LeadPolicy = {
	sections: Partial<Record<SectionId, LeadSectionSetting>>;
};

/** The starting policy: every work section editable. */
export const DEFAULT_LEAD_POLICY: LeadPolicy = {
	sections: Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [section, 'edit'])
	) as Record<SectionId, LeadSectionSetting>,
};

const LEAD_SECTION_SETTINGS: readonly LeadSectionSetting[] = [
	'hidden',
	'view',
	'edit',
];

export function isLeadSectionSetting(
	value: unknown
): value is LeadSectionSetting {
	return (
		typeof value === 'string' &&
		(LEAD_SECTION_SETTINGS as readonly string[]).includes(value)
	);
}

/**
 * Read a stored policy into the full canonical section map.
 *
 * Accepts either `{ sections: { ... } }` or a bare section map. Only
 * `WORK_SECTION_IDS` keys are read, so unknown keys are dropped. A missing,
 * unknown, or invalid value defaults to `edit` — the approved starting policy
 * — because a section the operator never configured must not silently narrow
 * lead access.
 */
export function normalizeLeadSectionRecord(
	value: unknown
): Record<SectionId, LeadSectionSetting> {
	let stored: unknown = value;
	if (
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		'sections' in value
	) {
		const candidate = value.sections;
		if (
			candidate &&
			typeof candidate === 'object' &&
			!Array.isArray(candidate)
		) {
			stored = candidate;
		}
	}

	const rawValues: Record<string, unknown> = {};
	if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
		for (const [key, setting] of Object.entries(stored)) {
			rawValues[key] = setting;
		}
	}

	const sections = {} as Record<SectionId, LeadSectionSetting>;
	for (const section of WORK_SECTION_IDS) {
		const setting = rawValues[section];
		sections[section] = isLeadSectionSetting(setting) ? setting : 'edit';
	}

	return sections;
}

export function normalizeLeadPolicy(value: unknown): LeadPolicy {
	return { sections: normalizeLeadSectionRecord(value) };
}
