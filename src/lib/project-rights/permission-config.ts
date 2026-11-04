/**
 * The Projects module configuration written by the permission editor.
 *
 * The section keys are the canonical `WORK_SECTION_IDS` plus the protected
 * `commercial` pseudo-section. The policy only understands section ids from
 * `sections.ts`, so the editor and the server share this one definition.
 */

import {
	COMMERCIAL_COLUMN_ALIASES,
	COMMERCIAL_SECTION,
	PROTECTED_COMMERCIAL_COLUMNS,
	SECTION_LABELS,
	WORK_SECTION_IDS,
	type SectionId,
} from './sections';
import {
	PROJECT_ACTIONS,
	type ProjectAction,
	type ProjectScope,
} from './grants';

export type FieldPermissionLevel = 'hidden' | 'view' | 'edit';

export type PermissionFieldDefinition = {
	label: string;
	type: string;
	sensitive?: boolean;
};

export type PermissionSectionDefinition = {
	name: string;
	fields: Record<string, PermissionFieldDefinition>;
};

export type PermissionSectionDefinitions = Record<
	string,
	PermissionSectionDefinition
>;

export type PermissionModuleDefinition = {
	name: string;
	description: string;
	category: string;
	sections: PermissionSectionDefinitions;
};

export type PermissionFieldState = Record<
	string,
	Record<string, FieldPermissionLevel | undefined> | undefined
>;

export type SavedPermissionSection = {
	enabled: boolean;
	name: string;
	fields: Record<
		string,
		{ label: string; permission: FieldPermissionLevel; sensitive: boolean }
	>;
};

export type SavedPermissionSections = Record<string, SavedPermissionSection>;

/**
 * The actions that can carry an existing-project scope. `create` has no
 * existing project to scope against.
 */
export const PROJECT_SCOPED_ACTIONS = [
	'read',
	'update',
	'assign',
	'close',
	'delete',
	'reopen',
] as const;

export type ProjectScopedAction = (typeof PROJECT_SCOPED_ACTIONS)[number];

export const PROJECT_SCOPE_OPTIONS: readonly {
	value: ProjectScope;
	label: string;
	meaning: string;
}[] = [
	{
		value: 'led',
		label: 'Led projects only',
		meaning: 'Only projects where the user holds the Project Lead team role.',
	},
	{
		value: 'assigned',
		label: 'Assigned projects only',
		meaning: 'Only projects where the user is on the project team.',
	},
	{
		value: 'all',
		label: 'All projects',
		meaning: 'Every project, including projects with no team relationship.',
	},
];

export const PROJECT_PERMISSION_SECTIONS: PermissionSectionDefinitions = {
	project_details: {
		name: SECTION_LABELS.project_details,
		fields: {
			project_id: { label: 'Project ID', type: 'text' },
			project_code: { label: 'Project Code', type: 'text' },
			project_name: { label: 'Project Name', type: 'text' },
			client_name: { label: 'Client Name', type: 'text' },
			project_type: { label: 'Project Type', type: 'select' },
			description: { label: 'Description', type: 'textarea' },
			status: { label: 'Status', type: 'select' },
			priority: { label: 'Priority', type: 'select' },
			start_date: { label: 'Start Date', type: 'date' },
			end_date: { label: 'End Date', type: 'date' },
			due_date: { label: 'Due Date', type: 'date' },
			project_manager: { label: 'Project Manager', type: 'select' },
			team_members: { label: 'Team Members', type: 'multiselect' },
		},
	},
	scope: {
		name: SECTION_LABELS.scope,
		fields: {
			original_scope: { label: 'Original Scope', type: 'textarea' },
			additional_scope: { label: 'Additional Scope', type: 'textarea' },
			scope_changes: { label: 'Scope Changes', type: 'textarea' },
			deliverables: { label: 'Deliverables', type: 'textarea' },
		},
	},
	project_activity: {
		name: SECTION_LABELS.project_activity,
		fields: {
			activity_name: { label: 'Activity Name', type: 'text' },
			assigned_to: { label: 'Assigned To', type: 'select' },
			activity_status: { label: 'Activity Status', type: 'select' },
			estimated_hours: { label: 'Estimated Hours', type: 'number' },
			actual_hours: { label: 'Actual Hours', type: 'number' },
			activity_progress: { label: 'Activity Progress', type: 'number' },
		},
	},
	project_schedule: {
		name: SECTION_LABELS.project_schedule,
		fields: {
			milestone_name: { label: 'Milestone Name', type: 'text' },
			planned_start: { label: 'Planned Start', type: 'date' },
			planned_end: { label: 'Planned End', type: 'date' },
			actual_start: { label: 'Actual Start', type: 'date' },
			actual_end: { label: 'Actual End', type: 'date' },
			progress: { label: 'Progress', type: 'number' },
		},
	},
	project_team: {
		name: SECTION_LABELS.project_team,
		fields: {
			project_team: { label: 'Project Team', type: 'view' },
		},
	},
	documents_received: {
		name: SECTION_LABELS.documents_received,
		fields: {
			document_name: { label: 'Document Name', type: 'text' },
			document_type: { label: 'Document Type', type: 'select' },
			received_date: { label: 'Received Date', type: 'date' },
			received_from: { label: 'Received From', type: 'text' },
			document_file: { label: 'Document File', type: 'file' },
		},
	},
	documents_issued: {
		name: SECTION_LABELS.documents_issued,
		fields: {
			issued_doc_name: { label: 'Document Name', type: 'text' },
			issued_doc_type: { label: 'Document Type', type: 'select' },
			issue_date: { label: 'Issue Date', type: 'date' },
			issued_to: { label: 'Issued To', type: 'text' },
			revision: { label: 'Revision', type: 'text' },
			issued_file: { label: 'Document File', type: 'file' },
			prepared_by: { label: 'Prepared By', type: 'text' },
			checked_by: { label: 'Checked By', type: 'text' },
			approved_by: { label: 'Approved By', type: 'text' },
			client_approval: { label: 'Client Approval', type: 'text' },
		},
	},
	minutes_internal_meet: {
		name: SECTION_LABELS.minutes_internal_meet,
		fields: {
			meeting_date: { label: 'Meeting Date', type: 'date' },
			meeting_type: { label: 'Meeting Type', type: 'select' },
			attendees: { label: 'Attendees', type: 'multiselect' },
			minutes: { label: 'Minutes of Meeting', type: 'textarea' },
			action_items: { label: 'Action Items', type: 'textarea' },
		},
	},
	project_handover: {
		name: SECTION_LABELS.project_handover,
		fields: {
			handover_date: { label: 'Handover Date', type: 'date' },
			handover_to: { label: 'Handover To', type: 'text' },
			handover_notes: { label: 'Handover Notes', type: 'textarea' },
			completion_certificate: {
				label: 'Completion Certificate',
				type: 'file',
			},
			final_deliverables: { label: 'Final Deliverables', type: 'textarea' },
		},
	},
	project_manhours: {
		name: SECTION_LABELS.project_manhours,
		fields: {
			budget_hours: { label: 'Budget Hours', type: 'number' },
			estimated_hours: { label: 'Estimated Hours', type: 'number' },
			actual_hours: { label: 'Actual Hours', type: 'number' },
			variance: { label: 'Variance', type: 'number' },
			manhours_report: { label: 'Manhours Report', type: 'report' },
		},
	},
	software: {
		name: SECTION_LABELS.software,
		fields: {
			software_name: { label: 'Software Name', type: 'text' },
			software_version: { label: 'Version', type: 'text' },
			license_type: { label: 'License Type', type: 'select' },
			license_expiry: { label: 'License Expiry', type: 'date' },
		},
	},
	query_log: {
		name: SECTION_LABELS.query_log,
		fields: {
			query_date: { label: 'Query Date', type: 'date' },
			query_from: { label: 'Query From', type: 'text' },
			query_description: { label: 'Query Description', type: 'textarea' },
			response: { label: 'Response', type: 'textarea' },
			response_date: { label: 'Response Date', type: 'date' },
			query_status: { label: 'Status', type: 'select' },
		},
	},
	assumption: {
		name: SECTION_LABELS.assumption,
		fields: {
			assumption_text: { label: 'Assumption', type: 'textarea' },
			assumption_category: { label: 'Category', type: 'select' },
			assumption_status: { label: 'Status', type: 'select' },
			validation_date: { label: 'Validation Date', type: 'date' },
		},
	},
	lessons_learnt: {
		name: SECTION_LABELS.lessons_learnt,
		fields: {
			lesson_category: { label: 'Category', type: 'select' },
			lesson_description: { label: 'Description', type: 'textarea' },
			recommendations: { label: 'Recommendations', type: 'textarea' },
			lesson_date: { label: 'Date Recorded', type: 'date' },
		},
	},
	discussion: {
		name: SECTION_LABELS.discussion,
		fields: {
			discussion_date: { label: 'Discussion Date', type: 'date' },
			discussion_topic: { label: 'Topic', type: 'text' },
			discussion_participants: {
				label: 'Participants',
				type: 'multiselect',
			},
			discussion_notes: { label: 'Notes', type: 'textarea' },
		},
	},
	upload_documents: {
		name: SECTION_LABELS.upload_documents,
		fields: {
			document_name: { label: 'Document Name', type: 'text' },
			document_type: { label: 'Document Type', type: 'select' },
			document_file: { label: 'Document File', type: 'file' },
			uploaded_by: { label: 'Uploaded By', type: 'text' },
			upload_date: { label: 'Upload Date', type: 'date' },
		},
	},
	[COMMERCIAL_SECTION]: {
		name: 'Commercial',
		fields: {
			budget: { label: 'Budget', type: 'currency', sensitive: true },
			project_value: {
				label: 'Project Value',
				type: 'currency',
				sensitive: true,
			},
			cost_to_company: {
				label: 'Cost to Company',
				type: 'currency',
				sensitive: true,
			},
			profitability: {
				label: 'Profitability',
				type: 'currency',
				sensitive: true,
			},
			actual_profit_loss: {
				label: 'Actual Profit / Loss',
				type: 'currency',
				sensitive: true,
			},
			invoice_amount: {
				label: 'Invoice Amount',
				type: 'currency',
				sensitive: true,
			},
			billing_type: { label: 'Billing Type', type: 'select' },
			payment_status: { label: 'Payment Status', type: 'select' },
		},
	},
};

export const PROJECT_PERMISSION_MODULE: PermissionModuleDefinition = {
	name: 'Projects',
	description: 'Project management',
	category: 'module',
	sections: PROJECT_PERMISSION_SECTIONS,
};

/**
 * Build the saved `sections` tree for one module. Field state is keyed per
 * section so a repeated field name (`estimated_hours`, `notes`, `status`)
 * cannot overwrite an unrelated section.
 */
export function buildSectionPayload(
	sections: PermissionSectionDefinitions,
	fieldState: PermissionFieldState | null | undefined,
	enabledState: Record<string, boolean> | null | undefined
): SavedPermissionSections {
	const payload: SavedPermissionSections = {};

	for (const [sectionKey, section] of Object.entries(sections)) {
		const fields: SavedPermissionSection['fields'] = {};
		for (const [fieldKey, field] of Object.entries(section.fields)) {
			fields[fieldKey] = {
				label: field.label,
				permission: fieldState?.[sectionKey]?.[fieldKey] ?? 'hidden',
				sensitive: field.sensitive ?? false,
			};
		}
		payload[sectionKey] = {
			enabled: Boolean(enabledState?.[sectionKey]),
			name: section.name,
			fields,
		};
	}

	return payload;
}

/**
 * Build the saved `projectScopes.projects` tree. Only granted actions are
 * stored, and a granted action without a chosen scope fails closed to `led`.
 */
export function buildProjectScopesPayload(
	scopes: Partial<Record<ProjectAction, ProjectScope>> | null | undefined,
	grantedActions: Iterable<ProjectAction>
): Partial<Record<ProjectAction, ProjectScope>> {
	const granted = new Set(grantedActions);
	const payload: Partial<Record<ProjectAction, ProjectScope>> = {};

	for (const action of PROJECT_ACTIONS) {
		if (!granted.has(action)) continue;
		payload[action] = scopes?.[action] ?? 'led';
	}

	return payload;
}

/** Protected commercial column names covered by the configurable fields. */
export function configuredCommercialColumns(): string[] {
	const fields = PROJECT_PERMISSION_SECTIONS[COMMERCIAL_SECTION]?.fields ?? {};
	const columns = Object.keys(fields).map(
		(fieldKey) => COMMERCIAL_COLUMN_ALIASES[fieldKey] ?? fieldKey
	);
	return [...new Set(columns)].filter((column) =>
		(PROTECTED_COMMERCIAL_COLUMNS as readonly string[]).includes(column)
	);
}

/** Canonical work section ids plus the commercial pseudo-section. */
export const PROJECT_PERMISSION_SECTION_IDS: readonly (
	| SectionId
	| typeof COMMERCIAL_SECTION
)[] = [...WORK_SECTION_IDS, COMMERCIAL_SECTION];
