/**
 * Canonical project tab definitions shared between
 *   src/app/projects/[id]/page.jsx (view-only) and
 *   src/app/projects/[id]/edit/EditProjectForm.jsx (editable).
 *
 * Edit renders form controls; view renders read-only cards/tables.
 * Both must use the SAME field keys so data saved in edit appears in view.
 *
 * Field mapping (projects table JSON columns):
 *  project_details          -> name, project_code, client_name, start_date, end_date, type, estimated_manhours, list_of_deliverables etc
 *  scope                    -> scope_of_work, additional_scope
 *  project_activity         -> project_activities_list
 *  project_schedule         -> project_schedule_list
 *  project_team             -> project_team
 *  documents_received       -> documents_received_list (fallback input_documents_list / input_document for legacy)
 *  documents_issued         -> documents_issued_list
 *  minutes_internal_meet    -> kickoff_meetings_list + internal_meetings_list
 *  project_handover         -> project_handover_list
 *  project_manhours         -> project_manhours_list
 *  query_log                -> project_query_log_list
 *  assumption               -> project_assumption_list
 *  lessons_learnt           -> project_lessons_learnt_list
 *  software                 -> software_items
 *  discussion               -> not in projects (threaded comments)
 *  quotation/purchase_order/invoice -> child tables /api/projects/[id]/quotation etc
 *  upload_documents         -> entity_documents (project)
 */

// id must be stable — used as URL/query param and activeTab state
export const PROJECT_TABS = [
	{ id: 'project_details', label: 'Project Details' },
	{ id: 'scope', label: 'Scope' },
	{ id: 'project_activity', label: 'Project Activity' },
	{ id: 'project_schedule', label: 'Schedule' },
	{ id: 'project_team', label: 'Project Team' },
	{ id: 'documents_received', label: 'Input Document' },
	{ id: 'documents_issued', label: 'Deliverables' },
	{ id: 'minutes_internal_meet', label: 'Meeting' },
	{ id: 'project_handover', label: 'Progress Measurement' },
	{ id: 'project_manhours', label: 'Project Manhours' },
	{ id: 'software', label: 'Software' },
	{ id: 'query_log', label: 'Query Log' },
	{ id: 'assumption', label: 'Assumption' },
	{ id: 'lessons_learnt', label: 'Lessons Learnt' },
	{ id: 'discussion', label: 'Discussion' },
	{ id: 'quotation', label: 'Quotation', requiresPermission: 'quotations' },
	{
		id: 'purchase_order',
		label: 'Purchase Order',
		requiresPermission: 'purchase_orders',
	},
	{ id: 'invoice', label: 'Invoice', requiresPermission: 'invoices' },
	{ id: 'upload_documents', label: 'Upload Documents' },
];

// Legacy id aliases so old data / old links still resolve
export const TAB_ALIASES = {
	input_documents: 'documents_received',
	input_document: 'documents_received',
	documents_received_list: 'documents_received',
	project_team_tab: 'project_team',
	team: 'project_team',
	deliverables: 'documents_issued',
	progress_measurement: 'project_handover',
	manhours: 'project_manhours',
};

export function resolveTabId(id) {
	if (!id) return id;
	return TAB_ALIASES[id] || id;
}

export function isTabVisible(
	tab,
	{ can, RESOURCES, PERMISSIONS, isSuperAdmin }
) {
	if (tab.requiresPermission) {
		if (isSuperAdmin) return true;
		// quotations/purchase_orders/invoices use dedicated resource checks
		const map = {
			quotations: RESOURCES?.QUOTATIONS,
			purchase_orders: RESOURCES?.PURCHASE_ORDERS,
			invoices: RESOURCES?.INVOICES,
		};
		const res = map[tab.requiresPermission];
		if (!res) return true;
		return can?.(res, PERMISSIONS?.READ) || can?.(res, PERMISSIONS?.UPDATE);
	}
	return true;
}
