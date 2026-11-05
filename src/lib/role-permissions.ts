/**
 * Flat role-permission catalogue.
 *
 * `roles_master.permissions` stores flat `resource:action` keys. This module
 * turns that payload into the groups the user-permissions screen displays and
 * edits, without inventing a second permission format.
 */

import { PERMISSIONS, PERMISSION_DESCRIPTIONS, RESOURCES } from '@/utils/rbac';

export type RolePermissionAction = {
	key: string;
	label: string;
	description: string;
	granted: boolean;
};

export type RolePermissionGroup = {
	resource: string;
	label: string;
	actions: RolePermissionAction[];
};

const ACTION_LABELS: Record<string, string> = {
	read: 'View',
	create: 'Create',
	update: 'Edit',
	delete: 'Delete',
	export: 'Export',
	import: 'Import',
	approve: 'Approve',
	assign: 'Assign',
	close: 'Close',
	reopen: 'Reopen',
	convert: 'Convert',
};

const RESOURCE_LABELS: Record<string, string> = {
	leads: 'Leads',
	projects: 'Projects',
	employees: 'Employees',
	users: 'Users',
	companies: 'Companies',
	vendors: 'Vendors',
	proposals: 'Proposals',
	dashboard: 'Dashboard',
	reports: 'Reports',
	work_logs: 'Work Logs',
	messages: 'Messages',
	profile: 'Profile',
	tickets: 'Tickets',
	followups: 'Follow-ups',
	todos: 'Todos',
	quotations: 'Quotations',
	purchase_orders: 'Purchase Orders',
	invoices: 'Invoices',
	activities: 'Activities',
	software: 'Software',
	documents: 'Documents',
	deliverables: 'Deliverables',
	roles: 'Roles',
	holidays: 'Holidays',
	accounts: 'Accounts',
	admin: 'Admin',
	settings: 'Settings',
	admin_monitoring: 'Admin Monitoring',
	admin_activity_logs: 'Admin Activity Logs',
	admin_audit_logs: 'Admin Audit Logs',
	admin_productivity: 'Admin Productivity',
	payroll: 'Payroll',
	material_requisition: 'Material Requisition',
	cash_voucher: 'Cash Voucher',
	other_expenses: 'Other Expenses',
	petty_cash_expenses: 'Petty Cash Expenses',
	attendance: 'Attendance',
	leaves: 'Leaves',
};

const DEFAULT_ACTIONS = [
	PERMISSIONS.READ,
	PERMISSIONS.CREATE,
	PERMISSIONS.UPDATE,
	PERMISSIONS.DELETE,
];

function humanize(value: string): string {
	return value
		.split(/[_:]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function rolePermissionKey(resource: string, action: string): string {
	return `${resource}:${action}`;
}

/** Parse array, JSON string, or legacy comma-separated role permissions. */
export function parseRolePermissions(value: unknown): string[] {
	if (value === null || value === undefined) return [];

	let parsed: unknown = value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return [];
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text.split(',');
		}
	}

	if (!Array.isArray(parsed)) return [];

	const keys = parsed
		.filter((item): item is string => typeof item === 'string')
		.map((item) => item.trim())
		.filter((item) => item.includes(':'));

	return [...new Set(keys)].sort();
}

/**
 * Build the editor/display groups for a permission set.
 *
 * Every known resource is listed with its described actions; resources
 * without a description fall back to the standard CRUD actions. Any stored
 * action missing from the catalogue is still shown, so an old grant cannot
 * become invisible and unremovable.
 */
export function getRolePermissionGroups(
	grantedPermissions: readonly string[]
): RolePermissionGroup[] {
	const grantedSet = new Set(grantedPermissions);
	const resourceOrder = Object.values(RESOURCES) as string[];
	const resourceSet = new Set(resourceOrder);
	const extraResources: string[] = [];

	for (const key of grantedSet) {
		const [resource] = key.split(':');
		if (resource && !resourceSet.has(resource)) {
			resourceSet.add(resource);
			extraResources.push(resource);
		}
	}

	const groups: RolePermissionGroup[] = [];

	for (const resource of [...resourceOrder, ...extraResources]) {
		const described = PERMISSION_DESCRIPTIONS[resource] as
			| Record<string, string>
			| undefined;
		const isExtraResource = extraResources.includes(resource);
		const actions = new Set<string>(
			Object.keys(described ?? {}).length > 0
				? Object.keys(described ?? {})
				: isExtraResource
					? []
					: DEFAULT_ACTIONS
		);

		for (const key of grantedSet) {
			const [grantedResource, action] = key.split(':');
			if (grantedResource === resource && action) actions.add(action);
		}

		groups.push({
			resource,
			label: RESOURCE_LABELS[resource] ?? humanize(resource),
			actions: [...actions].map((action) => ({
				key: rolePermissionKey(resource, action),
				label: ACTION_LABELS[action] ?? humanize(action),
				description:
					described?.[action] ?? `${humanize(action)} ${humanize(resource)}`,
				granted: grantedSet.has(rolePermissionKey(resource, action)),
			})),
		});
	}

	return groups;
}

/** Toggle one flat permission key. */
export function toggleRolePermission(
	permissions: readonly string[],
	key: string
): string[] {
	const next = new Set(permissions);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return [...next].sort();
}

/** The flat payload the roles API expects. */
export function serializeRolePermissions(
	permissions: readonly string[]
): string[] {
	return [...new Set(permissions)].sort();
}
