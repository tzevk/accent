/**
 * Field-level access gate shared by report pages and their API routes.
 *
 * Several reports (project-status, client-balance, sales-register, …) reuse
 * the "project activities" report grant. Super admins and `reports:read`
 * holders are handled by callers; this helper answers the narrower question
 * "does this user hold the field-level grant?" for `project_activities`
 * (current) or `project_reports` (legacy), with `view`/`edit` both counting
 * as access.
 *
 * `field_permissions` may arrive as a parsed object (session) or a JSON
 * string (DB row) — both are handled here.
 */

interface ReportAccessUser {
	is_super_admin?: boolean | number | null;
	field_permissions?: unknown;
}

type FieldPermissionsShape = {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
};

export function hasProjectActivitiesFieldPermission(
	user: ReportAccessUser | null | undefined
): boolean {
	if (!user) return false;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = (fieldPerms as FieldPermissionsShape | null)?.modules?.reports
		?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}
