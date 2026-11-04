/**
 * Canonical project section vocabulary.
 *
 * One list of section identifiers is shared by the permission payload, the
 * project policy, and the tab configuration in `src/lib/project-tabs.js`.
 * The tab ids intentionally match the section ids; aliases are resolved by
 * the project-tabs helper before this module is consulted.
 */

export const WORK_SECTION_IDS = [
	'project_details',
	'scope',
	'project_activity',
	'project_schedule',
	'project_team',
	'documents_received',
	'documents_issued',
	'minutes_internal_meet',
	'project_handover',
	'project_manhours',
	'software',
	'query_log',
	'assumption',
	'lessons_learnt',
	'discussion',
	'upload_documents',
] as const;

export type SectionId = (typeof WORK_SECTION_IDS)[number];

/** The protected commercial pseudo-section is never a work section. */
export const COMMERCIAL_SECTION = 'commercial';
export type LeadSectionSetting = 'hidden' | 'view' | 'edit';

export const SECTION_LABELS: Record<SectionId, string> = {
	project_details: 'Project Details',
	scope: 'Scope',
	project_activity: 'Project Activity',
	project_schedule: 'Schedule',
	project_team: 'Project Team',
	documents_received: 'Input Document',
	documents_issued: 'Deliverables',
	minutes_internal_meet: 'Meeting',
	project_handover: 'Progress Measurement',
	project_manhours: 'Project Manhours',
	software: 'Software',
	query_log: 'Query Log',
	assumption: 'Assumption',
	lessons_learnt: 'Lessons Learnt',
	discussion: 'Discussion',
	upload_documents: 'Upload Documents',
};

/** Section id -> tab id. The workspace renders tabs from these ids. */
export const SECTION_TABS: Record<SectionId, string> = {
	project_details: 'project_details',
	scope: 'scope',
	project_activity: 'project_activity',
	project_schedule: 'project_schedule',
	project_team: 'project_team',
	documents_received: 'documents_received',
	documents_issued: 'documents_issued',
	minutes_internal_meet: 'minutes_internal_meet',
	project_handover: 'project_handover',
	project_manhours: 'project_manhours',
	software: 'software',
	query_log: 'query_log',
	assumption: 'assumption',
	lessons_learnt: 'lessons_learnt',
	discussion: 'discussion',
	upload_documents: 'upload_documents',
};

/** Tab id -> section id. */
export const TAB_SECTION_MAP: Record<string, SectionId> = Object.fromEntries(
	WORK_SECTION_IDS.map((section) => [SECTION_TABS[section], section])
) as Record<string, SectionId>;

/**
 * The ordinary member baseline: exactly the ten sections that already exist
 * for a Project Team Member without lead status or explicit grants.
 */
export const MEMBER_READ_SECTIONS: readonly SectionId[] = [
	'scope',
	'project_schedule',
	'documents_received',
	'documents_issued',
	'project_team',
	'query_log',
	'assumption',
	'lessons_learnt',
	'discussion',
	'upload_documents',
];

/**
 * Commercial amounts are protected. They are absent from every response
 * unless the actor holds the matching commercial field permission.
 */
export const PROTECTED_COMMERCIAL_COLUMNS = [
	'budget',
	'project_value',
	'cost_to_company',
	'profitability_estimate',
	'actual_profit_loss',
] as const;

export type ProtectedCommercialColumn =
	(typeof PROTECTED_COMMERCIAL_COLUMNS)[number];

/**
 * The permission editor stores shorter field keys in some deployments.
 * Map them to the real project column before comparing.
 */
export const COMMERCIAL_COLUMN_ALIASES: Record<string, string> = {
	profitability: 'profitability_estimate',
	invoice_amount: 'invoice_amount',
};

/**
 * Section -> readable project columns. Used to omit unreadable sections from
 * read payloads; `SECTION_WRITES` below owns the write map.
 */
export const SECTION_COLUMNS: Record<SectionId, readonly string[]> = {
	project_details: [
		'name',
		'project_code',
		'client_name',
		'client_contact_details',
		'project_type',
		'type',
		'description',
		'status',
		'priority',
		'start_date',
		'end_date',
		'target_date',
		'project_manager',
		'estimated_manhours',
		'list_of_deliverables',
		'industry',
		'contract_type',
		'project_location_country',
		'project_location_city',
		'project_location_site',
		'company_id',
		'proposal_id',
		'notes',
	],
	scope: [
		'scope_of_work',
		'additional_scope',
		'scope',
		'assigned_disciplines',
		'discipline_descriptions',
	],
	project_activity: [
		'project_activities_list',
		'project_activities',
		'activities',
		'assigned_activities',
		'team_members',
	],
	project_schedule: ['project_schedule_list', 'project_schedule'],
	project_team: ['project_team'],
	documents_received: [
		'documents_received_list',
		'input_documents_list',
		'input_document',
	],
	documents_issued: ['documents_issued_list'],
	minutes_internal_meet: [
		'kickoff_meetings_list',
		'internal_meetings_list',
		'kickoff_meeting',
		'in_house_meeting',
	],
	project_handover: ['project_handover_list'],
	project_manhours: ['project_manhours_list'],
	software: ['software_items'],
	query_log: ['project_query_log_list'],
	assumption: ['project_assumption_list'],
	lessons_learnt: ['project_lessons_learnt_list'],
	discussion: [],
	upload_documents: [],
};

/**
 * How a section is saved.
 *
 * `project_columns` sections are written by `PUT /api/projects/[id]` through
 * `{ section, values }`: every key must be one of the section's direct
 * columns or JSON/list columns. Sections that are not saved through the
 * project row say so explicitly so a handcrafted request cannot write here.
 */
export type SectionWriteMode = 'project_columns' | 'sub_resource';

export type SectionWriteDefinition = {
	mode: SectionWriteMode;
	/** Direct `projects` columns. */
	columns: readonly string[];
	/** JSON/list `projects` columns serialized on write. */
	listColumns: readonly string[];
	/** Where a sub-resource section is mutated instead. */
	writePath?: string;
};

/**
 * Writable project columns per section, derived from the former whole-form
 * PUT field list and the tab components. Protected commercial columns never
 * appear here: they belong to the `commercial` pseudo-section only.
 */
export const SECTION_WRITES: Record<SectionId, SectionWriteDefinition> = {
	project_details: {
		mode: 'project_columns',
		columns: [
			'name',
			'project_code',
			'client_name',
			'client_contact_details',
			'project_location_country',
			'project_location_city',
			'project_location_site',
			'industry',
			'contract_type',
			'company_id',
			'project_manager',
			'type',
			'start_date',
			'end_date',
			'target_date',
			'project_duration_planned',
			'project_duration_actual',
			'priority',
			'assigned_to',
			'description',
			'notes',
			'proposal_id',
			'estimated_manhours',
			'unit_qty',
			'duration',
			'list_of_deliverables',
		],
		listColumns: [],
	},
	scope: {
		mode: 'project_columns',
		columns: ['scope_of_work', 'additional_scope'],
		listColumns: [],
	},
	project_activity: {
		mode: 'project_columns',
		columns: [],
		listColumns: [
			'project_activities_list',
			'planning_activities_list',
			'team_members',
		],
	},
	project_schedule: {
		mode: 'project_columns',
		columns: [
			'project_start_milestone',
			'project_review_milestone',
			'project_end_milestone',
		],
		listColumns: ['project_schedule_list'],
	},
	project_team: {
		mode: 'sub_resource',
		columns: [],
		listColumns: [],
		writePath: '/api/projects/[id]/team',
	},
	documents_received: {
		mode: 'project_columns',
		columns: [],
		listColumns: [
			'documents_received_list',
			'input_documents_list',
			'input_document',
		],
	},
	documents_issued: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['documents_issued_list'],
	},
	minutes_internal_meet: {
		mode: 'project_columns',
		columns: [
			'kickoff_meeting',
			'in_house_meeting',
			'kickoff_meeting_date',
			'kickoff_followup_date',
			'internal_meeting_date',
			'next_internal_meeting',
		],
		listColumns: ['kickoff_meetings_list', 'internal_meetings_list'],
	},
	project_handover: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['project_handover_list'],
	},
	project_manhours: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['project_manhours_list'],
	},
	software: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['software_items'],
	},
	query_log: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['project_query_log_list'],
	},
	assumption: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['project_assumption_list'],
	},
	lessons_learnt: {
		mode: 'project_columns',
		columns: [],
		listColumns: ['project_lessons_learnt_list'],
	},
	discussion: {
		mode: 'sub_resource',
		columns: [],
		listColumns: [],
		writePath: '/api/projects/[id]/followups',
	},
	upload_documents: {
		mode: 'sub_resource',
		columns: [],
		listColumns: [],
		writePath: '/api/document-upload',
	},
};

/** Writable project columns for sections saved through the project row. */
export const SECTION_WRITE_COLUMNS: Record<SectionId, readonly string[]> =
	Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [
			section,
			SECTION_WRITES[section].columns,
		])
	) as Record<SectionId, readonly string[]>;

/** JSON/list project columns for sections saved through the project row. */
export const SECTION_LIST_COLUMNS: Record<SectionId, readonly string[]> =
	Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [
			section,
			SECTION_WRITES[section].listColumns,
		])
	) as Record<SectionId, readonly string[]>;

/** The only columns a `commercial` save may write, each needing edit rights. */
export const COMMERCIAL_WRITE_COLUMNS = PROTECTED_COMMERCIAL_COLUMNS;

/**
 * Identity and list-safe fields that stay visible for any project the actor
 * may open. A section filter never removes them.
 */
export const PROJECT_IDENTITY_FIELDS = [
	'id',
	'project_id',
	'project_code',
	'name',
	'status',
	'priority',
	'start_date',
	'end_date',
	'created_at',
] as const;

export function isSectionId(value: unknown): value is SectionId {
	return (
		typeof value === 'string' &&
		(WORK_SECTION_IDS as readonly string[]).includes(value)
	);
}

export function isProtectedCommercialColumn(
	value: string
): value is ProtectedCommercialColumn {
	return (PROTECTED_COMMERCIAL_COLUMNS as readonly string[]).includes(value);
}

/** True when the section is saved through the project row itself. */
export function isProjectWritableSection(section: SectionId): boolean {
	return SECTION_WRITES[section]?.mode === 'project_columns';
}
